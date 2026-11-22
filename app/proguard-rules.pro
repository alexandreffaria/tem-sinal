# Gson reads and writes these classes by reflection, so their field names are the JSON names in
# the files on the phone and in the server's requests and answers, and its enums are written by
# constant name. R8 keeps them as written.
-keep class dev.meuquerido.cellsignalmapper.Sample { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.Fix { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.SimReading { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.CellReading { <fields>; }
-keep enum dev.meuquerido.cellsignalmapper.ServiceStatus { <fields>; }
-keep enum dev.meuquerido.cellsignalmapper.OverrideNetworkType { <fields>; }
-keep enum dev.meuquerido.cellsignalmapper.CellSource { <fields>; }
-keep enum dev.meuquerido.cellsignalmapper.Rat { <fields>; }
-keep enum dev.meuquerido.cellsignalmapper.CellConnection { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.Recording { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.RecordingList { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.ListedSession { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.ListAnswer { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.UploadAnswer { <fields>; }
-keep class dev.meuquerido.cellsignalmapper.RejectedSample { <fields>; }

# Stack traces from a release build map back to source lines with the build's mapping.txt.
-keepattributes SourceFile,LineNumberTable
