"use client";

import * as m from "motion/react-m";
import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { createPersonalInfoChange, type PersonalInfoResult } from "@/app/(protected)/employees/[id]/actions";
import { Button } from "@/components/ui/button";
import { InputField } from "@/components/ui/field";
import { useMotionOn } from "@/components/ui/motion";
import { messages } from "@/lib/i18n/es-MX";
import {
  PERSONAL_INFO_STEPS,
  firstStepWithError,
  type PersonalInfoField,
  type PersonalInfoFieldErrors,
} from "@/lib/personal-info-steps";

// 9c PR 6d (D51): "Actualizar información personal" in three steps. All the
// steps stay mounted (the others hidden) so what was typed is kept. Each step
// change moves the focus to the step's title; a step only goes forward when
// its own fields are valid, with the errors next to each field and a count of
// them in an alert region. On save the Server Action validates the whole
// object with zod; its errors take the form back to the first step that has
// one, and any other failure shows in a second alert region.
// The step that appears slides in with motion/react. With
// prefers-reduced-motion, or before the animation features load, it has no
// start state at all, so it is painted where it ends, in its first frame.

export interface PersonalInfoValues {
  firstName: string;
  lastName: string;
  middleName?: string;
  phone?: string;
  personalEmail?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
}

interface PersonalInfoStepsProps {
  employeeId: string;
  /** D42: today's date (YYYY-MM-DD) in the tenant's time zone. */
  today: string;
  current: PersonalInfoValues | null;
  /** D45: the dialog's lists could not be loaded; nothing can be sent. */
  blocked: boolean;
  onDone: () => void;
}

const t = messages.personalInfoForm;
const f = messages.fields;
const LAST = PERSONAL_INFO_STEPS.length - 1;
const STEP_VARIANTS = { shown: { opacity: 1, y: 0 }, away: { opacity: 0, y: 8 } };
const DANGER_NOTE = "rounded-lg border border-danger-line bg-danger-subtle px-4 py-2 text-sm text-danger-fg";

/** The browser's verdict on one control, in the form's words. */
function controlError(control: HTMLInputElement): string | null {
  if (control.validity.valueMissing) return t.required;
  if (control.validity.typeMismatch) return t.invalidEmail;
  return null;
}

export function PersonalInfoSteps({ employeeId, today, current, blocked, onDone }: PersonalInfoStepsProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const titleRefs = useRef<(HTMLHeadingElement | null)[]>([]);
  const [step, setStep] = useState(0);
  // Bumped on every step change, including a return to the same step, so the title takes the focus.
  const [focusRequest, setFocusRequest] = useState(0);
  const [errors, setErrors] = useState<PersonalInfoFieldErrors>({});
  const [summary, setSummary] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const motionOn = useMotionOn();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (focusRequest > 0) titleRefs.current[step]?.focus();
  }, [focusRequest, step]);

  // A dialog closed before the saved message's 1.2 s does not close a later one.
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  function goTo(index: number) {
    setStep(index);
    setFocusRequest((n) => n + 1);
  }

  function control(field: PersonalInfoField): HTMLInputElement | null {
    const element = formRef.current?.elements.namedItem(field);
    return element instanceof HTMLInputElement ? element : null;
  }

  /** Checks one step's fields with the browser's validity; true when the step can go on. */
  function checkStep(index: number): boolean {
    const found: PersonalInfoFieldErrors = {};
    for (const field of PERSONAL_INFO_STEPS[index].fields) {
      const input = control(field);
      const message = input ? controlError(input) : null;
      if (message) found[field] = message;
    }
    const failed = Object.keys(found) as PersonalInfoField[];
    setErrors((all) => {
      const next = { ...all };
      for (const field of PERSONAL_INFO_STEPS[index].fields) delete next[field];
      return { ...next, ...found };
    });
    setSummary(failed.length > 0 ? t.stepErrors(failed.length) : "");
    if (failed.length > 0) control(failed[0])?.focus();
    return failed.length === 0;
  }

  function value(form: FormData, field: PersonalInfoField): string | undefined {
    const text = form.get(field);
    return typeof text === "string" && text !== "" ? text : undefined;
  }

  function save() {
    const form = new FormData(formRef.current ?? undefined);
    setFailure(null);
    startTransition(async () => {
      let result: PersonalInfoResult;
      try {
        result = await createPersonalInfoChange({
          userId: employeeId,
          startDate: value(form, "startDate") ?? "",
          firstName: value(form, "firstName") ?? "",
          lastName: value(form, "lastName") ?? "",
          middleName: value(form, "middleName"),
          phone: value(form, "phone"),
          personalEmail: value(form, "personalEmail"),
          addressLine1: value(form, "addressLine1"),
          city: value(form, "city"),
          state: value(form, "state"),
          postalCode: value(form, "postalCode"),
          country: value(form, "country") ?? "MX",
          emergencyContactName: value(form, "emergencyContactName"),
          emergencyContactPhone: value(form, "emergencyContactPhone"),
          eventReason: value(form, "eventReason") ?? "",
        });
      } catch {
        // The action threw (network failure, server crash).
        setFailure(t.saveFailed);
        return;
      }
      if (result.success) {
        setSaved(t.saved);
        closeTimer.current = setTimeout(onDone, 1200);
        return;
      }
      if ("fieldErrors" in result) {
        setErrors(result.fieldErrors);
        setSummary(result.error);
        goTo(firstStepWithError(result.fieldErrors) ?? LAST);
        return;
      }
      setFailure(result.error);
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // After a save, nothing more is sent while the saved message shows.
    if (blocked || isPending || saved || !checkStep(step)) return;
    if (step < LAST) goTo(step + 1);
    else save();
  }

  const field = (name: PersonalInfoField, label: string, extra: { required?: boolean; type?: string; defaultValue?: string } = {}) => (
    <InputField key={name} name={name} label={label} error={errors[name]} type={extra.type ?? "text"} required={extra.required} defaultValue={extra.defaultValue} />
  );

  const fields: Record<PersonalInfoField, () => ReactNode> = {
    startDate: () => field("startDate", f.effectiveDate, { type: "date", required: true, defaultValue: today }),
    firstName: () => field("firstName", f.firstName, { required: true, defaultValue: current?.firstName }),
    middleName: () => field("middleName", t.middleName, { defaultValue: current?.middleName }),
    lastName: () => field("lastName", f.lastName, { required: true, defaultValue: current?.lastName }),
    phone: () => field("phone", f.phone, { type: "tel", defaultValue: current?.phone }),
    personalEmail: () => field("personalEmail", f.personalEmail, { type: "email", defaultValue: current?.personalEmail }),
    emergencyContactName: () => field("emergencyContactName", t.emergencyContactName, { defaultValue: current?.emergencyContactName }),
    emergencyContactPhone: () => field("emergencyContactPhone", t.emergencyContactPhone, { type: "tel", defaultValue: current?.emergencyContactPhone }),
    addressLine1: () => field("addressLine1", t.address, { defaultValue: current?.addressLine1 }),
    city: () => field("city", f.city, { defaultValue: current?.city }),
    state: () => field("state", f.state, { defaultValue: current?.state }),
    postalCode: () => field("postalCode", f.postalCode, { defaultValue: current?.postalCode }),
    country: () => field("country", f.country, { defaultValue: current?.country ?? "MX" }),
    eventReason: () => field("eventReason", f.reason, { required: true }),
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-5">
      {/* Live regions stay in the page and only their text changes, so screen readers announce it (4.1.3).
          One wrapper, so the empty ones add no gap. */}
      <div>
        <div role="alert" className={summary ? `${DANGER_NOTE} mb-2 last:mb-0` : undefined}>
          {summary}
        </div>
        <div role="alert" className={failure ? `${DANGER_NOTE} mb-2 last:mb-0` : undefined}>
          {failure}
        </div>
        <div role="status" className={saved ? "rounded-lg border border-success-line bg-success-subtle px-4 py-2 text-sm text-success-fg" : undefined}>
          {saved}
        </div>
      </div>

      {PERSONAL_INFO_STEPS.map((s, index) => (
        <m.div
          key={s.id}
          data-step={s.id}
          hidden={index !== step}
          {...(motionOn ? { initial: false, animate: index === step ? "shown" : "away", variants: STEP_VARIANTS } : {})}
          className="space-y-5"
        >
          <h3
            ref={(el) => {
              titleRefs.current[index] = el;
            }}
            tabIndex={-1}
            className="text-base font-semibold text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t.stepTitle(index + 1, PERSONAL_INFO_STEPS.length, s.title)}
          </h3>
          {s.fields.map((name) => fields[name]())}
        </m.div>
      ))}

      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              setSummary("");
              goTo(step - 1);
            }}
            disabled={isPending || saved !== null}
          >
            {t.back}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" loading={isPending} disabled={blocked}>
          {step < LAST ? t.next : t.save}
        </Button>
      </div>
    </form>
  );
}
