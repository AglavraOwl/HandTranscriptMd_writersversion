/* =============================================
   OpenRouter — Elenco modelli, test connessione, picker
   Nessuna di queste funzioni fa parte dell'IRecognizer:
   servono alle impostazioni per popolare/validare la
   configurazione prima che l'utente inizi a scrivere.
   ============================================= */

import { App, FuzzySuggestModal, FuzzyMatch, requestUrl } from 'obsidian';
import { t } from './i18n';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/key';
const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/* ---------- Elenco modelli ---------- */

export interface OpenRouterModel {
	id: string;      // es. "google/gemini-2.5-flash" — usato nelle chiamate API
	name: string;     // nome leggibile, es. "Google: Gemini 2.5 Flash"
	isFree: boolean;  // pricing.prompt e pricing.completion entrambi "0"
	isVision: boolean; // architecture.input_modalities include "image"
}

// Forma grezza della risposta di GET /api/v1/models (solo i campi che ci servono)
interface OpenRouterModelsResponse {
	data?: Array<{
		id: string;
		name?: string;
		architecture?: { input_modalities?: string[] };
		pricing?: { prompt?: string; completion?: string };
	}>;
}

// Elenco pubblico dei modelli OpenRouter (non richiede chiave API).
// Il chiamante filtra poi per isVision (l'OCR richiede input immagine).
export async function fetchOpenRouterModels(): Promise<OpenRouterModel[]> {
	const resp = await requestUrl({ url: MODELS_URL, method: 'GET', throw: false });
	if (resp.status !== 200) throw new Error(`OpenRouter ${resp.status}`);

	const json = resp.json as OpenRouterModelsResponse;
	return (json.data ?? []).map(m => ({
		id: m.id,
		name: m.name ?? m.id,
		// "0" esatto, non un controllo di soglia: verificato contro l'API reale --
		// il suffisso ":free" nell'id non è affidabile (alcuni modelli gratuiti non lo hanno)
		isFree: m.pricing?.prompt === '0' && m.pricing?.completion === '0',
		isVision: m.architecture?.input_modalities?.includes('image') ?? false,
	}));
}

/* ---------- Test connessione ---------- */

export interface ConnectionTestResult {
	ok: boolean;
	message: string;
}

// Verifica la chiave Gemini con una chiamata leggera (elenco modelli, nessun costo di generazione)
export async function testGeminiConnection(apiKey: string): Promise<ConnectionTestResult> {
	if (!apiKey.trim()) return { ok: false, message: t('error_gemini_key_missing') };
	try {
		const resp = await requestUrl({ url: `${GEMINI_MODELS_URL}?key=${apiKey}`, method: 'GET', throw: false });
		if (resp.status === 200) return { ok: true, message: '' };
		const errJson = resp.json as { error?: { message?: string } };
		return { ok: false, message: errJson?.error?.message ?? String(resp.status) };
	} catch (e: unknown) {
		// requestUrl rigetta la promise per errori di rete (es. nessuna connessione internet)
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

// Verifica la chiave OpenRouter con GET /api/v1/key (info sui limiti, nessun costo di generazione)
export async function testOpenRouterConnection(apiKey: string): Promise<ConnectionTestResult> {
	if (!apiKey.trim()) return { ok: false, message: t('error_openrouter_key_missing') };
	try {
		const resp = await requestUrl({
			url: KEY_URL,
			method: 'GET',
			headers: { Authorization: `Bearer ${apiKey}` },
			throw: false,
		});
		if (resp.status === 200) return { ok: true, message: '' };
		const errJson = resp.json as { error?: { message?: string } };
		return { ok: false, message: errJson?.error?.message ?? String(resp.status) };
	} catch (e: unknown) {
		return { ok: false, message: e instanceof Error ? e.message : String(e) };
	}
}

/* ---------- Picker modale (ricerca fuzzy) ---------- */
// Stesso pattern di SvgReferenceSuggest in main.ts: FuzzySuggestModal per
// cercare tra molte voci invece di un <select> enorme.

export class OpenRouterModelSuggestModal extends FuzzySuggestModal<OpenRouterModel> {
	private models: OpenRouterModel[];
	private onSelect: (model: OpenRouterModel) => void;

	constructor(app: App, models: OpenRouterModel[], onSelect: (model: OpenRouterModel) => void) {
		super(app);
		// Solo i modelli capaci di leggere immagini sono utilizzabili per l'OCR --
		// mostrare gli altri porterebbe l'utente a scegliere un modello che fallirà sempre
		this.models = models.filter(m => m.isVision);
		this.onSelect = onSelect;
		this.setPlaceholder(t('model_search_placeholder'));
	}

	getItems(): OpenRouterModel[] {
		return this.models;
	}

	// Include la parola "free" nel testo di ricerca dei modelli gratuiti,
	// così digitare "free" nella ricerca fuzzy li fa emergere tutti.
	getItemText(model: OpenRouterModel): string {
		return `${model.name} ${model.id}${model.isFree ? ' free' : ''}`;
	}

	renderSuggestion(match: FuzzyMatch<OpenRouterModel>, el: HTMLElement): void {
		const model = match.item;
		el.createEl('div', { text: model.name });
		el.createEl('div', {
			text: model.isFree ? `${model.id} — ${t('model_free_suffix')}` : model.id,
			cls: 'setting-item-description',
		});
	}

	onChooseItem(model: OpenRouterModel): void {
		this.onSelect(model);
	}
}
