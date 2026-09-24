/* =============================================
   Recognizer — Abstraction layer OCR via Gemini o OpenRouter
   Funziona sia su Windows che su Android.
   Riceve un'immagine PNG in base64, la invia
   al provider OCR selezionato e restituisce il testo riconosciuto.
   L'interfaccia IRecognizer permette di aggiungere
   in futuro altri backend OCR senza toccare embed.ts.
   ============================================= */

import { requestUrl } from 'obsidian';
import { t } from './i18n';
import type { HandwritingSettings } from './settings';

// Modello Gemini da usare per il riconoscimento visivo
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/* ---------- Interfaccia comune ---------- */
// Mantiene l'astrazione: in futuro si può aggiungere un backend
// alternativo (es. OCR locale) senza modificare embed.ts

export interface IRecognizer {
	recognize(imageBase64: string, continuousMode?: boolean, wordlist?: string[]): Promise<string>;
}

/* ---------- Prompt condiviso ---------- */
// Costruisce il prompt OCR (identico per Gemini e OpenRouter): specifica
// le lingue attese, il formato di output e i suggerimenti di vocabolario.
function buildOcrPrompt(languages: string[], continuousMode: boolean, wordlist: string[]): string {
	const langList = languages.join(', ');
	// Simboli markdown preservati (identici nei due prompt)
	const preserved = `#, ##, ###, -, *, >, %%, \`\`\`, **text**, *text*, ==text==, ~~text~~, - [ ], - [x]`;
	// Suggerimenti di vocabolario personalizzato (nomi propri, parole inventate, ecc.)
	// raccolti da wordlist.ts — vedi impostazione "Custom wordlist"
	const wordlistHint = wordlist.length > 0
		? `The following words or names may appear in the text -- if the handwriting resembles one of them, prefer this exact spelling: ${wordlist.join(', ')}. `
		: '';

	// Modalita Continuous: non chiediamo al modello di decidere quali a capo unire
	// (giudizio inaffidabile) -- trascrive letteralmente riga per riga, il plugin
	// unisce poi le righe in codice (vedi md-parser.ts, collapseContinuousLines).
	// L'unica cosa che il modello deve riconoscere fedelmente e' il marcatore //Z.
	return continuousMode
		?
		`You are an OCR system specialized in handwriting recognition. ` +
		`Analyze the image and transcribe exactly the text that was written, line by line, ` +
		`exactly as laid out -- do NOT try to join or merge any lines yourself, keep every line break exactly where the handwriting has one. ` +
		`The expected languages are: ${langList}. ` +
		wordlistHint +
		`Preserve the markdown symbols written by the user (e.g. ${preserved}). ` +
		`If the user wrote the marker //Z, transcribe it exactly as "//Z" on its own line, unchanged. ` +
		`Return ONLY the transcribed text, with no additional explanation.`
		:
		`You are an OCR system specialized in handwriting recognition. ` +
		`Analyze the image and transcribe exactly the text that was written. ` +
		`The expected languages are: ${langList}. ` +
		wordlistHint +
		`Preserve the markdown symbols written by the user (e.g. ${preserved}). ` +
		`When text spans multiple lines due to page space limits (word wrap), ` +
		`join those lines into a single continuous paragraph, replacing the line break with a space. ` +
		`Return ONLY the transcribed text, as one continuous paragraph, with no additional explanation.`;
}

/* ---------- GeminiRecognizer ---------- */

// Tipo della risposta JSON di Gemini (solo i campi che ci servono)
interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{ text?: string }>;
		};
	}>;
	error?: { message?: string };
}

class GeminiRecognizer implements IRecognizer {
	constructor(
		private apiKey: string,
		private languages: string[]
	) {}

	async recognize(imageBase64: string, continuousMode = false, wordlist: string[] = []): Promise<string> {
		const prompt = buildOcrPrompt(this.languages, continuousMode, wordlist);

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

/* ---------- OpenRouterRecognizer ---------- */

// Tipo della risposta JSON di OpenRouter (formato OpenAI-style, solo i campi che ci servono)
interface OpenRouterResponse {
	choices?: Array<{
		message?: { content?: string };
	}>;
	error?: { message?: string };
}

class OpenRouterRecognizer implements IRecognizer {
	constructor(
		private apiKey: string,
		private model: string,
		private languages: string[]
	) {}

	async recognize(imageBase64: string, continuousMode = false, wordlist: string[] = []): Promise<string> {
		const prompt = buildOcrPrompt(this.languages, continuousMode, wordlist);

		const resp = await requestUrl({
			url: OPENROUTER_URL,
			method: 'POST',
			contentType: 'application/json',
			headers: { Authorization: `Bearer ${this.apiKey}` },
			throw: false,
			body: JSON.stringify({
				model: this.model,
				messages: [{
					role: 'user',
					content: [
						{ type: 'text', text: prompt },
						// Immagine PNG in base64, formato OpenAI-style data URL
						{ type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } }
					]
				}]
			})
		});

		// Gestione errori HTTP (chiave non valida, modello non trovato, quota esaurita, ecc.)
		if (resp.status !== 200) {
			const errJson = resp.json as OpenRouterResponse;
			throw new Error(`OpenRouter ${resp.status}: ${errJson?.error?.message ?? String(resp.status)}`);
		}

		const json = resp.json as OpenRouterResponse;
		const text = json?.choices?.[0]?.message?.content ?? '';
		return text.trim();
	}
}

/* ---------- Factory ---------- */

// Sceglie il recognizer in base al provider selezionato nelle impostazioni.
// Lancia un errore subito se la chiave (o il modello) manca, così embed.ts
// può mostrare un avviso chiaro all'utente prima di chiamare l'API.
export function getRecognizer(settings: HandwritingSettings): IRecognizer {
	if (settings.ocrProvider === 'openrouter') {
		if (!settings.openrouterApiKey.trim()) throw new Error(t('error_openrouter_key_missing'));
		if (!settings.openrouterModel.trim()) throw new Error(t('error_openrouter_model_missing'));
		return new OpenRouterRecognizer(settings.openrouterApiKey, settings.openrouterModel, settings.ocrLanguages);
	}
	if (!settings.geminiApiKey.trim()) throw new Error(t('error_gemini_key_missing'));
	return new GeminiRecognizer(settings.geminiApiKey, settings.ocrLanguages);
}
