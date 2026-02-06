export type Result<T, E> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(data: T): Result<T, never> => ({ ok: true, data });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
