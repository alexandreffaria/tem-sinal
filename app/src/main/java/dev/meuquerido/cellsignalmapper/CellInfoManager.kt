package dev.meuquerido.cellsignalmapper

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
