import type {
  ProviderConfigSummary,
  ProviderGenerationRequest,
  ProviderGenerationResult,
  ProviderValidationResult,
} from '../types.ts';

export interface ProviderAdapter {
  id: ProviderConfigSummary['provider'];
  displayName: string;
  configSummary(): ProviderConfigSummary;
  validate(input?: { model?: string }): Promise<ProviderValidationResult>;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
}
