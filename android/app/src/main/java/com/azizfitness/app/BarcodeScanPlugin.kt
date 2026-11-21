package com.azizfitness.app

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScanner
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning

/**
 * Google's barcode scanner (ML Kit code scanner, Google Play services) for modules/barcode-scanner/barcode-food.js.
 *
 * Opens Google's own full-screen scanner. It reads small, curved or worn food barcodes faster than the
 * WebView's camera + BarcodeDetector, and needs no camera permission (Play services owns the camera).
 * Free, on-device, no key. The scanner module is downloaded by Play services: at install time (the
 * com.google.mlkit.vision.DEPENDENCIES meta-data in AndroidManifest.xml) or on first use.
 *   available() -> { available, installed }  available=false when Play services can't provide it
 *   scan()      -> { code, format } on a scan, { cancelled: true } when the user backs out;
 *                  rejects with code "downloading" (module still downloading) or "unavailable" (anything else),
 *                  and barcode-food.js then falls back to the WebView camera.
 *
 * Registered in MainActivity before super.onCreate. The compiled copy lives next to MainActivity;
 * this file is the source of truth and modules/barcode-scanner/test/barcode-food.test.js checks they are identical.
 */
@CapacitorPlugin(name = "BarcodeScan")
class BarcodeScanPlugin : Plugin() {

    private fun scanner(): GmsBarcodeScanner {
        val options = GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(
                Barcode.FORMAT_EAN_13, Barcode.FORMAT_EAN_8, Barcode.FORMAT_UPC_A,
                Barcode.FORMAT_UPC_E, Barcode.FORMAT_ITF
            )
            .enableAutoZoom()
            .build()
        return GmsBarcodeScanning.getClient(activity, options)
    }

    @PluginMethod
    fun available(call: PluginCall) {
        try {
            ModuleInstall.getClient(context).areModulesAvailable(scanner())
                .addOnSuccessListener { r ->
                    call.resolve(JSObject().put("available", true).put("installed", r.areModulesAvailable()))
                }
                .addOnFailureListener { call.resolve(JSObject().put("available", false).put("installed", false)) }
        } catch (e: Exception) {
            call.resolve(JSObject().put("available", false).put("installed", false))
        }
    }

    @PluginMethod
    fun scan(call: PluginCall) {
        val s = try { scanner() } catch (e: Exception) { call.reject(e.message ?: "scanner error", "unavailable"); return }
        val installer = ModuleInstall.getClient(context)
        installer.areModulesAvailable(s)
            .addOnSuccessListener { r ->
                if (r.areModulesAvailable()) start(call, s)
                else {
                    // Ask Play services to fetch it now; this scan falls back to the WebView camera meanwhile.
                    installer.installModules(ModuleInstallRequest.newBuilder().addApi(s).build())
                    call.reject("Google's scanner is still downloading", "downloading")
                }
            }
            .addOnFailureListener { start(call, s) } // can't tell; let startScan decide
    }

    private fun start(call: PluginCall, s: GmsBarcodeScanner) {
        s.startScan()
            .addOnSuccessListener { b ->
                call.resolve(JSObject().put("code", b.rawValue ?: "").put("format", formatName(b.format)))
            }
            .addOnCanceledListener { call.resolve(JSObject().put("cancelled", true)) }
            .addOnFailureListener { e -> call.reject(e.message ?: "scan failed", "unavailable") }
    }

    private fun formatName(f: Int): String = when (f) {
        Barcode.FORMAT_EAN_13 -> "ean_13"
        Barcode.FORMAT_EAN_8 -> "ean_8"
        Barcode.FORMAT_UPC_A -> "upc_a"
        Barcode.FORMAT_UPC_E -> "upc_e"
        Barcode.FORMAT_ITF -> "itf"
        else -> "other"
    }
}
