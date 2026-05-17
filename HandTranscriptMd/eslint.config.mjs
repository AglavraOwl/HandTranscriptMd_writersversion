import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default defineConfig([
	...obsidianmd.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
			globals: {
				window: "readonly",
				performance: "readonly",
				console: "readonly",
				process: "readonly",
				Image: "readonly",
			},
		},
	},
]);
