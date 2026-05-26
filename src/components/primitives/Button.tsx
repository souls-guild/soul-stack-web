import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'iconOnly';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children?: ReactNode;
}

export function Button({ variant = 'secondary', className, children, ...rest }: Props) {
  const variantClass = styles[variant];
  const composed = [styles.base, variantClass, className].filter(Boolean).join(' ');
  return (
    <button className={composed} {...rest}>
      {children}
    </button>
  );
}
