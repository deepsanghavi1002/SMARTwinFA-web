/** The open cell editor's text around the caret, for the key-by-key typing rules (KeyPressEdit). */

/** The editor's text once a typed key replaces whatever is selected in it. */
export function remainingAfterKey(input: HTMLInputElement): string {
  const from = input.selectionStart ?? input.value.length;
  const to = input.selectionEnd ?? from;
  return input.value.slice(0, from) + input.value.slice(to);
}

/** Types `text` where the caret is, for a key taken in another case than the one pressed. */
export function typeAtCaret(input: HTMLInputElement, text: string, apply: (value: string) => void) {
  const from = input.selectionStart ?? input.value.length;
  const to = input.selectionEnd ?? from;
  apply(input.value.slice(0, from) + text + input.value.slice(to));
  requestAnimationFrame(() => input.setSelectionRange(from + text.length, from + text.length));
}
