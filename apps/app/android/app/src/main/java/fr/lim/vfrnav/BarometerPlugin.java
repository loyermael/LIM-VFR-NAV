package fr.lim.vfrnav;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Baromètre de l'appareil (Sensor.TYPE_PRESSURE, en hPa) pour L!M VFR Nav.
 *
 * Un navigateur n'a pas accès à ce capteur : ce plugin n'existe que dans la coque Android.
 * Le plugin envoie à la page des mesures brutes (événement "pressure") ; le filtrage, la conversion en
 * altitude et le QNH sont faits côté TypeScript (packages/core), où ils sont testés.
 *
 * Pas de code repris de XCSoar (GPL) : on utilise seulement l'API publique d'Android.
 */
@CapacitorPlugin(name = "Barometer")
public class BarometerPlugin extends Plugin implements SensorEventListener {

    /** Période d'échantillonnage demandée : 200 ms (5 Hz), largement suffisant pour une altitude et un vario. */
    private static final int SAMPLING_PERIOD_US = 200_000;

    private SensorManager sensorManager;
    private Sensor pressureSensor;
    /** Vrai tant que la page a demandé les mesures (même si l'application est passée en arrière-plan). */
    private boolean wanted = false;
    private boolean registered = false;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        pressureSensor = sensorManager != null ? sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE) : null;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", pressureSensor != null);
        call.resolve(result);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (pressureSensor == null) {
            call.reject("Pas de capteur de pression sur cet appareil");
            return;
        }
        wanted = true;
        startListening();
        if (!registered) {
            call.reject("Impossible d'activer le capteur de pression");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        wanted = false;
        stopListening();
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        // Écran éteint ou application en arrière-plan : on libère le capteur (économie de batterie).
        stopListening();
    }

    @Override
    protected void handleOnResume() {
        if (wanted) startListening();
    }

    @Override
    protected void handleOnDestroy() {
        wanted = false;
        stopListening();
    }

    private void startListening() {
        if (registered || sensorManager == null || pressureSensor == null) return;
        registered = sensorManager.registerListener(this, pressureSensor, SAMPLING_PERIOD_US);
    }

    private void stopListening() {
        if (!registered || sensorManager == null) return;
        sensorManager.unregisterListener(this);
        registered = false;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.values == null || event.values.length == 0) return;
        JSObject data = new JSObject();
        data.put("hPa", event.values[0]);
        data.put("timeMs", System.currentTimeMillis());
        notifyListeners("pressure", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // La précision annoncée par les capteurs de téléphone n'est pas fiable : on ne s'en sert pas.
    }
}
