import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["lib/"] },
  js.configs.recommended,
  tseslint.configs.strict,
  { files: ["src/**/*.test.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
);
