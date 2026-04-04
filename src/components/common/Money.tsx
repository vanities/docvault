import { useAppContext } from '../../contexts/AppContext';

interface MoneyProps {
  children: React.ReactNode;
  className?: string;
}

export function Money({ children, className }: MoneyProps) {
  const { blurNumbers } = useAppContext();
  return (
    <span
      className={blurNumbers ? `blur-sm select-none${className ? ` ${className}` : ''}` : className}
    >
      {children}
    </span>
  );
}
