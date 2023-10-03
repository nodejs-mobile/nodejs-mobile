import type { urlUpdateActions } from 'internal/url'

declare function InternalBinding(binding: 'url'): {
  urlComponents: Uint32Array;

  domainToASCII(input: string): string;
  domainToUnicode(input: string): string;
  canParse(input: string, base?: string): boolean;
  format(input: string, fragment?: boolean, unicode?: boolean, search?: boolean, auth?: boolean): string;
  parse(input: string, base?: string): string | false;
  update(input: string, actionType: typeof urlUpdateActions, value: string): string | false;
};
