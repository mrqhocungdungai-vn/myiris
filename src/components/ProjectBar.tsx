import { FolderOpen } from "lucide-react";

export default function ProjectBar({ project, onChoose }: { project: string | null; onChoose: () => void }) {
  return (
    <button
      className={`project-bar ${project ? "" : "unset"}`}
      data-no-dwell
      onClick={onChoose}
      title={
        project
          ? `Claude works in ${project} — click to change (changing starts a fresh Claude context)`
          : "Claude works in the default workspace — click to attach this session to a project folder"
      }
    >
      <FolderOpen size={13} />
      <span className="project-path">{project ? project.split("/").filter(Boolean).pop() : "Choose project folder…"}</span>
    </button>
  );
}
