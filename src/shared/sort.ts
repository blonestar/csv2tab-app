/** Poređenje teksta po srpskoj latinici (č, ć, đ, š, ž na svom mestu), brojevi u tekstu po vrednosti. */
export const compareText = new Intl.Collator('sr-Latn', { numeric: true }).compare;
