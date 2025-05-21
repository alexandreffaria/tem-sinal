package com.example.cellsignalmapper

import android.Manifest
import android.telephony.CellIdentityGsm
import android.telephony.CellIdentityLte
import android.telephony.CellIdentityNr
import android.telephony.CellIdentityWcdma
import androidx.annotation.RequiresPermission
import android.os.Build


import android.content.Context
import android.telephony.*

@RequiresPermission(Manifest.permission.ACCESS_FINE_LOCATION)

fun getFormattedCellInfo(context: Context): List<String> {
    val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    val infoList = telephonyManager.allCellInfo ?: return listOf("No cell info")

    val registered = infoList.find { it.isRegistered } ?: return listOf("No registered tower")

    val type = registered.javaClass.simpleName
    val signal = registered.cellSignalStrength.dbm
    val identity = registered.cellIdentity

    val (mcc, mnc) = when (identity) {
        is CellIdentityLte -> identity.mccString to identity.mncString
        is CellIdentityNr -> identity.mccString to identity.mncString
        is CellIdentityGsm -> identity.mccString to identity.mncString
        is CellIdentityWcdma -> identity.mccString to identity.mncString
        else -> null to null
    }

    val mccSafe = mcc ?: "?"
    val mncSafe = mnc ?: "?"
    val carrierName = getCarrierName(mccSafe, mncSafe)

    val id = when (identity) {
        is CellIdentityLte -> "CI: ${identity.ci}, TAC: ${identity.tac}, PCI: ${identity.pci}"
        is CellIdentityNr -> "CI: ${identity.nci}, TAC: ${identity.tac}, PCI: ${identity.pci}"
        is CellIdentityGsm -> "CID: ${identity.cid}, LAC: ${identity.lac}"
        is CellIdentityWcdma -> "CID: ${identity.cid}, LAC: ${identity.lac}"
        else -> "Unknown Cell Identity"
    }

    return listOf("✅ [$type] $signal dBm — $carrierName (MCC:$mccSafe MNC:$mncSafe), $id")
}


fun getCarrierName(mcc: String, mnc: String): String {
    return when ("$mcc$mnc") {
        // Brazil - Vivo
        "72406", "72410", "72411", "72423" -> "Vivo (Telefônica Brasil)"
        // Brazil - TIM
        "72402", "72403", "72404" -> "TIM Brasil"
        // Brazil - Claro
        "72405" -> "Claro Brasil"
        // Brazil - Oi (now mostly absorbed by others)
        "72430", "72431" -> "Oi (Legacy)"
        // Brazil - Algar Telecom
        "72432", "72433", "72434" -> "Algar Telecom"
        // Brazil - Porto Seguro Telecom
        "72454" -> "Porto Seguro Telecom"
        // Brazil - Nextel (legacy)
        "72439" -> "Nextel (Legacy)"
        else -> "Unknown Carrier"
    }
}
