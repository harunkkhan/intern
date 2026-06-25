import { Playfair_Display } from "next/font/google";

const logoFont = Playfair_Display({
  subsets: ["latin"],
  weight: "600",
  style: "italic",
});

export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`${logoFont.className} inline-block select-none leading-none italic ${className}`}
    >
      it
    </span>
  );
}
