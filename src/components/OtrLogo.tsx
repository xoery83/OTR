type OtrLogoProps = {
  className?: string;
};

export function OtrLogo({ className = "size-10" }: OtrLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="OTR"
      className={`shrink-0 rounded-xl object-cover ${className}`}
    />
  );
}
