package fr.lim.vfrnav;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Les plugins locaux doivent être enregistrés avant super.onCreate().
        registerPlugin(BarometerPlugin.class);
        super.onCreate(savedInstanceState);
        // Écran allumé pendant la navigation (la page web le demande aussi, mais ceci est plus fiable dans une WebView).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
