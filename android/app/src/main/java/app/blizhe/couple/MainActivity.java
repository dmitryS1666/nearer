package app.blizhe.couple;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
