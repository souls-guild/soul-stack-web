import { forwardRef, type InputHTMLAttributes } from 'react';
import styles from './Input.module.css';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, hint, error, mono, className, ...rest },
  ref,
) {
  const inputClass = [styles.input, mono ? styles.mono : '', className].filter(Boolean).join(' ');
  return (
    <label className={styles.field}>
      {label}
      <input
        ref={ref}
        className={inputClass}
        aria-invalid={error ? 'true' : undefined}
        {...rest}
      />
      {error ? <span className={styles.error}>{error}</span> : hint ? <span className={styles.hint}>{hint}</span> : null}
    </label>
  );
});
