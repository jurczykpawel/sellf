'use client';

interface GoBackButtonProps {
  label: string;
}

export default function GoBackButton({ label }: GoBackButtonProps) {
  return (
    <button
      onClick={() => window.history.back()}
      className="w-full bg-gf-accent-bg hover:bg-gf-accent-hover text-white font-semibold py-2 px-4 rounded-full transition-[background-color] duration-200 active:scale-[0.98]"
    >
      {label}
    </button>
  );
}
