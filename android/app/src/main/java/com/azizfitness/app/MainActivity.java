package com.azizfitness.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts.
        registerPlugin(HealthConnectPlugin.class);
        registerPlugin(GoogleHealthPlugin.class);
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(GoogleSignInPlugin.class);
        registerPlugin(SpeechPlugin.class);
        registerPlugin(RestTimerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
