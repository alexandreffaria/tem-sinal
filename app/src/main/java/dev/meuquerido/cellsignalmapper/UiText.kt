package dev.meuquerido.cellsignalmapper

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

/**
 * A text to show: the string resource [id] formatted with [args]. An argument that is itself a
 * [UiText] is resolved first, so a line can embed a translated phrase.
 */
data class UiText(@StringRes val id: Int, val args: List<Any> = emptyList())

/** This text in the current locale. */
@Composable
fun UiText.resolve(): String =
    stringResource(id, *args.map { if (it is UiText) it.resolve() else it }.toTypedArray())
