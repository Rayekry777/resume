import { useState } from 'react';
import { getPresentationMode, type ResumeDocument } from '../model';

/** The renderer needs the visible projection, including the original paper design. */
function printableDocument(resume: ResumeDocument | null): ResumeDocument | null {
  if (!resume) return null;
  return {
    id: resume.id, schemaVersion: 1, title: resume.title, templateId: resume.templateId,
    presentationMode: getPresentationMode(resume), profile: resume.profile, layout: resume.layout,
    sections: resume.sections.filter(section => section.visible), createdAt: 0, updatedAt: 0, revision: 0,
  };
}

// Editor updates usually share most of their tree. Storage validation recreates
// objects and may reorder keys, even when every printable value is unchanged.
function equalValues(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => equalValues(item, right[index]));
  }
  if (Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalValues(a[key], b[key]));
}

/** Retain the exact same input for autosaves, source-only changes and editor UI preferences. */
export function usePdfInput(resume: ResumeDocument | null): ResumeDocument | null {
  const [last, setLast] = useState(() => ({ resume, paper: printableDocument(resume) }));
  if (resume === last.resume) return last.paper;
  const next = printableDocument(resume);
  const paper = equalValues(last.paper, next) ? last.paper : next;
  setLast({ resume, paper });
  return paper;
}
