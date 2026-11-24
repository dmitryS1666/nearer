package app.blizhe.couple;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ApkUpdate")
public class ApkUpdatePlugin extends Plugin {
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url", "");
        final String expectedHash = call.getString("sha256", "").toLowerCase(Locale.US);
        final Integer expectedCode = call.getInt("versionCode");
        if (url == null || !url.startsWith("https://") || expectedHash == null || !expectedHash.matches("[a-f0-9]{64}") || expectedCode == null) {
            call.reject("bad_update", "bad_update");
            return;
        }
        io.execute(() -> {
            File apk = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("storage", "storage");
                    return;
                }
                apk = new File(dir, "nearer-update.apk");
                if (apk.exists() && !apk.delete()) {
                    call.reject("storage", "storage");
                    return;
                }
                download(url, apk);
                String actual = sha256(apk);
                if (!expectedHash.equals(actual)) {
                    apk.delete();
                    call.reject("sha256_mismatch", "sha256_mismatch");
                    return;
                }
                PackageCheck check = inspect(apk, expectedCode);
                if (!check.ok) {
                    apk.delete();
                    call.reject(check.reason, check.reason);
                    return;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent settings = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settings.setData(Uri.parse("package:" + getContext().getPackageName()));
                    settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(settings);
                    call.reject("permission_required", "permission_required");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent install = new Intent(Intent.ACTION_VIEW);
                install.setDataAndType(uri, "application/vnd.android.package-archive");
                install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(install);
                JSObject result = new JSObject();
                result.put("status", "installer_opened");
                call.resolve(result);
            } catch (Exception error) {
                if (apk != null) apk.delete();
                call.reject("download_failed", "download_failed");
            }
        });
    }

    private void download(String url, File dest) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(true);
        try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(dest)) {
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = input.read(buffer)) >= 0) {
                total += read;
                if (total > 80L * 1024L * 1024L) throw new IllegalStateException("too_large");
                output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }

    private String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        byte[] hash = digest.digest();
        StringBuilder out = new StringBuilder();
        for (byte value : hash) out.append(String.format(Locale.US, "%02x", value));
        return out.toString();
    }

    private PackageCheck inspect(File apk, int expectedCode) {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo incoming = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        if (incoming == null || incoming.applicationInfo == null) return PackageCheck.fail("bad_apk");
        incoming.applicationInfo.sourceDir = apk.getAbsolutePath();
        incoming.applicationInfo.publicSourceDir = apk.getAbsolutePath();
        if (!getContext().getPackageName().equals(incoming.packageName)) return PackageCheck.fail("package_mismatch");
        long incomingCode = Build.VERSION.SDK_INT >= 28 ? incoming.getLongVersionCode() : incoming.versionCode;
        if (incomingCode != expectedCode) return PackageCheck.fail("version_mismatch");
        try {
            PackageInfo mine = manager.getPackageInfo(getContext().getPackageName(), flags);
            if (!sameSignature(signaturesOf(mine), signaturesOf(incoming))) return PackageCheck.fail("signature_mismatch");
        } catch (Exception error) {
            return PackageCheck.fail("signature_unverified");
        }
        return PackageCheck.ok();
    }

    private Signature[] signaturesOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            Signature[] current = info.signingInfo.getApkContentsSigners();
            if (current != null && current.length > 0) return current;
        }
        return info.signatures == null ? new Signature[0] : info.signatures;
    }

    private boolean sameSignature(Signature[] left, Signature[] right) {
        if (left.length == 0 || right.length == 0) return false;
        for (Signature a : left) {
            for (Signature b : right) {
                if (a != null && b != null && Arrays.equals(a.toByteArray(), b.toByteArray())) return true;
            }
        }
        return false;
    }

    private static final class PackageCheck {
        final boolean ok;
        final String reason;
        private PackageCheck(boolean ok, String reason) {
            this.ok = ok;
            this.reason = reason;
        }
        static PackageCheck ok() { return new PackageCheck(true, ""); }
        static PackageCheck fail(String reason) { return new PackageCheck(false, reason); }
    }
}
