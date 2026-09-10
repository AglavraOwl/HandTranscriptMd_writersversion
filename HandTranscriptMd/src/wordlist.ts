/* =============================================
   Wordlist — Elenco parole personalizzate per l'OCR
   Cerca file "handwriting-words.md" risalendo dalla cartella
   della nota fino alla radice del vault, unendo tutti quelli trovati.
   Permette di suggerire all'OCR nomi propri e parole inventate
   (es. nomi di personaggi) che altrimenti vengono letti male.
   ============================================= */

import { TFile } from 'obsidian';
import type HandwritingPlugin from './main';

export const WORDLIST_FILENAME = 'handwriting-words.md';

// Risale da sourcePath fino alla radice del vault, restituendo ogni
// cartella attraversata (radice inclusa, come stringa vuota).
function ancestorFolders(sourcePath: string): string[] {
	const folders: string[] = [];
	let current = sourcePath.includes('/') ? sourcePath.substring(0, sourcePath.lastIndexOf('/')) : '';
	for (;;) {
		folders.push(current);
		if (!current) break;
		current = current.includes('/') ? current.substring(0, current.lastIndexOf('/')) : '';
	}
	return folders;
}

// Raccoglie le parole da tutti i file handwriting-words.md trovati risalendo
// dalla cartella della nota alla radice del vault (cascading, non "closest wins").
// Una riga per parola/frase; righe vuote o che iniziano con # vengono ignorate.
// Duplicati (case-insensitive) mantengono solo la prima occorrenza trovata.
export async function collectWordlist(sourcePath: string, plugin: HandwritingPlugin): Promise<string[]> {
	const seen = new Set<string>();
	const words: string[] = [];

	for (const folder of ancestorFolders(sourcePath)) {
		const path = folder ? `${folder}/${WORDLIST_FILENAME}` : WORDLIST_FILENAME;
		const file = plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;

		const content = await plugin.app.vault.read(file);
		for (const rawLine of content.split('\n')) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#')) continue;
			const key = line.toLowerCase();
			if (seen.has(key)) continue;
			seen.add(key);
			words.push(line);
		}
	}

	return words;
}
