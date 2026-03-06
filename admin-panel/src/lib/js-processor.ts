import { minify } from 'terser';

export interface ObfuscationConfig {
  minify: boolean;
  obfuscate: boolean;
  sourceMap: boolean;
  environment: 'development' | 'production';
}

export class JSProcessor {
  private static readonly DEFAULT_CONFIG: ObfuscationConfig = {
    minify: true,
    obfuscate: true,
    sourceMap: false,
    environment: 'production'
  };

  /**
   * Process JavaScript code with minification and obfuscation
   */
  static async processCode(code: string, config: Partial<ObfuscationConfig> = {}): Promise<string> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    let processedCode = code;

    try {
      // Step 1: Minify if enabled
      if (finalConfig.minify) {
        processedCode = await this.minifyCode(processedCode, finalConfig);
      }

      // Step 2: Obfuscate if enabled and in production
      if (finalConfig.obfuscate && finalConfig.environment === 'production') {
        processedCode = await this.obfuscateCode(processedCode);
      }

      return processedCode;
    } catch {
      // Return original code if processing fails
      return code;
    }
  }

  /**
   * Minify JavaScript code using Terser
   */
  private static async minifyCode(code: string, config: ObfuscationConfig): Promise<string> {
    const result = await minify(code, {
      compress: {
        dead_code: true,
        drop_console: config.environment === 'production',
        drop_debugger: true,
        passes: 2
      },
      mangle: {
        toplevel: true,
        reserved: ['Sellf', 'GATEKEEPER_CONFIG'] // Preserve important names
      },
      format: {
        comments: false,
        beautify: false
      },
      sourceMap: config.sourceMap
    });

    return result.code || code;
  }

  /**
   * Obfuscate JavaScript code
   */
  private static async obfuscateCode(code: string): Promise<string> {
    const { obfuscate } = await import('javascript-obfuscator');
    const obfuscated = obfuscate(code, {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.75,
      deadCodeInjection: true,
      deadCodeInjectionThreshold: 0.4,
      debugProtection: true,
      debugProtectionInterval: 4000,
      disableConsoleOutput: true,
      identifierNamesGenerator: 'hexadecimal',
      log: false,
      numbersToExpressions: true,
      renameGlobals: false,
      selfDefending: true,
      simplify: true,
      splitStrings: true,
      splitStringsChunkLength: 10,
      stringArray: true,
      stringArrayCallsTransform: true,
      stringArrayEncoding: ['rc4'],
      stringArrayIndexShift: true,
      stringArrayRotate: true,
      stringArrayShuffle: true,
      stringArrayWrappersCount: 2,
      stringArrayWrappersChainedCalls: true,
      stringArrayWrappersParametersMaxCount: 4,
      stringArrayWrappersType: 'function',
      stringArrayThreshold: 0.75,
      transformObjectKeys: true,
      unicodeEscapeSequence: false,
      // Preserve important global variables
      reservedNames: [
        'Sellf',
        'GATEKEEPER_CONFIG',
        'window',
        'document',
        'console',
        'fetch',
        'XMLHttpRequest'
      ]
    });

    return obfuscated.getObfuscatedCode();
  }

  /**
   * Get processing configuration based on environment
   */
  static getConfigForEnvironment(env: 'development' | 'production'): ObfuscationConfig {
    return {
      minify: env === 'production',
      obfuscate: env === 'production',
      sourceMap: env === 'development',
      environment: env
    };
  }
}
