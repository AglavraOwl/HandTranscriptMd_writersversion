/* =============================================
   Recognizer — Abstraction layer OCR via Gemini
   Funziona sia su Windows che su Android.
   Riceve un'immagine PNG in base64, la invia
   all'API Gemini e restituisce il testo riconosciuto.
   L'interfaccia IRecognizer permette di aggiungere
   in futuro altri backend OCR senza toccare embed.ts.
   ============================================= */

import { requestUrl } from 'obsidian';

// Modello Gemini da usare per il riconoscimento visivo
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Tipo della risposta JSON di Gemini (solo i campi che ci servono)
interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
	error?: { message?: string };
}

/* ---------- Interfaccia comune ---------- */
// Mantiene l'astrazione: in futuro si può aggiungere un backend
// alternativo (es. OCR locale) senza modificare embed.ts

export interface IRecognizer {
	recognize(imageBase64: string, continuousMode?: boolean): Promise<string>;
}

/* ---------- GeminiRecognizer ---------- */

class GeminiRecognizer implements IRecognizer {
	constructor(
		private apiKey: string,
		private languages: string[]
	) {}

	async recognize(imageBase64: string, continuousMode = false): Promise<string> {
		// Costruisce il prompt specificando le lingue attese e il formato di output
		const langList = this.languages.join(', ');
		// Simboli markdown preservati (identici nei due prompt)
		const preserved = `#, ##, ###, -, *, >, %%, \`\`\`, **text**, *text*, ==text==, ~~text~~, - [ ], - [x]`;

		// Modalita Continuous: non chiediamo al modello di decidere quali a capo unire
		// (giudizio inaffidabile) -- trascrive letteralmente riga per riga, il plugin
		// unisce poi le righe in codice (vedi md-parser.ts, collapseContinuousLines).
		// L'unica cosa che il modello deve riconoscere fedelmente e' il marcatore //Z.
		const prompt = continuousMode
			?
			`You are an OCR system specialized in handwriting recognition. ` +
			`Analyze the image and transcribe exactly the text that was written, line by line, ` +
			`exactly as laid out -- do NOT try to join or merge any lines yourself, keep every line break exactly where the handwriting has one. ` +
			`The expected languages are: ${langList}. ` +
			`Preserve the markdown symbols written by the user (e.g. ${preserved}). ` +
			`If the user wrote the marker //Z, transcribe it exactly as "//Z" on its own line, unchanged. ` +
			`Return ONLY the transcribed text, with no additional explanation.`
			:
			`You are an OCR system specialized in handwriting recognition. ` +
			`Analyze the image and transcribe exactly the text that was written. ` +
			`The expected languages are: ${langList}. ` +
			`Preserve the markdown symbols written by the user (e.g. ${preserved}). ` +
			`When text spans multiple lines due to page space limits (word wrap), ` +
			`join those lines into a single continuous paragraph, replacing the line break with a space. ` +
			`Return ONLY the transcribed text, as one continuous paragraph, with no additional explanation.`;

		// requestUrl è la funzione Obsidian per le richieste HTTP:
		// funziona uguale su Desktop e Android (a differenza di fetch nativo).
		// throw: false → non lancia eccezione su 4xx: gestiamo lo status manualmente.
		const resp = await requestUrl({
			url: `${GEMINI_URL}?key=${this.apiKey}`,
			method: 'POST',
			contentType: 'application/json',
			throw: false,
			body: JSON.stringify({
				contents: [{
					parts: [
						// Immagine PNG in base64
						{ inline_data: { mime_type: 'image/png', data: imageBase64 } },
						// Istruzioni OCR
						{ text: prompt }
					]
				}]
			})
		});

		// Gestione errori HTTP (chiave non valida, quota esaurita, ecc.)
		if (resp.status !== 200) {
			const errJson = resp.json as GeminiResponse;
			throw new Error(`Gemini ${resp.status}: ${errJson?.error?.message ?? String(resp.status)}`);
		}

		const json = resp.json as GeminiResponse;
		// Estrae il testo dal primo candidato
		const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
		return text.trim();
	}
}

/* ---------- Factory ---------- */

// Lancia un errore subito se la chiave manca, così embed.ts
// può mostrare un avviso chiaro all'utente prima di chiamare l'API
export function getRecognizer(apiKey: string, languages: string[]): IRecognizer {
	if (!apiKey.trim()) {
		throw new Error('Chiave API Gemini non configurata — aprire le impostazioni del plugin');
	}
	return new GeminiRecognizer(apiKey, languages);
}
