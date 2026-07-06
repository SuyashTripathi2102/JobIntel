import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiProvider } from './gemini.provider';
import { LLM_PROVIDER } from './llm.provider';

/**
 * Global so any feature module can inject LLM_PROVIDER. The concrete provider
 * is chosen by AI_PROVIDER config — add OpenAI/Claude implementations here
 * without touching any feature code.
 */
@Global()
@Module({
  providers: [
    GeminiProvider,
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService, GeminiProvider],
      useFactory: (config: ConfigService, gemini: GeminiProvider) => {
        const provider = config.get<string>('AI_PROVIDER', 'gemini');
        switch (provider) {
          case 'gemini':
            return gemini;
          default:
            throw new Error(`Unknown AI_PROVIDER "${provider}" (supported: gemini)`);
        }
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class AiModule {}
