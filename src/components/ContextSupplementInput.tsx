import { useState, type KeyboardEvent } from "react";
import { Link2 } from "lucide-react";

export default function ContextSupplementInput({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setValue("");
  }

  return (
    <div className="supplement-input">
      <Link2 size={13} />
      <input
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={disabled ? "Wake Iris to send a link or note" : "Paste a link or note for Claude to research…"}
      />
    </div>
  );
}
