interface QueryStateProps {
  isLoading: boolean;
  errorMessage: string | null;
  loadingLabel?: string;
}

export function QueryState({ isLoading, errorMessage, loadingLabel }: QueryStateProps) {
  if (isLoading) {
    return <p className="state state--loading">{loadingLabel ?? 'Loading...'}</p>;
  }

  if (errorMessage) {
    return <p className="state state--error">{errorMessage}</p>;
  }

  return null;
}
