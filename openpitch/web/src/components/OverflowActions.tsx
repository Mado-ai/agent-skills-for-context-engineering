import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Transition,
  type Variants,
} from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cx } from "../lib/cx";

/* Animated overflow-action cluster (adapted from the shadcn "overflow-actions"
 * pattern to framer-motion + our token system, with inline icons). Primary
 * actions stay visible; a toggle reveals the rest. */

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function useHoverCapable() {
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return canHover;
}

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
    <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export type OverflowActionItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  ariaLabel?: string;
};

const SHELL: Transition = { type: "spring", stiffness: 220, damping: 17, mass: 0.85 };

const ICON_VARIANTS: Variants = {
  hidden: { opacity: 0, filter: "blur(3px)" },
  visible: { opacity: 1, filter: "blur(0px)", transition: { duration: 0.18, ease: EASE_OUT } },
  exit: { opacity: 0, filter: "blur(3px)", transition: { duration: 0.18, ease: EASE_OUT } },
};
const OVERFLOW_VARIANTS: Variants = {
  hidden: { opacity: 0, filter: "blur(4px)" },
  visible: { opacity: 1, filter: "blur(0px)" },
  exit: { opacity: 0, filter: "blur(4px)" },
};

export interface OverflowActionsProps {
  primaryActions: OverflowActionItem[];
  overflowActions: OverflowActionItem[];
  onAction?: (item: OverflowActionItem) => void;
  collapseOnAction?: boolean;
  openLabel?: string;
  closeLabel?: string;
  className?: string;
}

export function OverflowActions({
  primaryActions,
  overflowActions,
  onAction,
  collapseOnAction = true,
  openLabel = "More actions",
  closeLabel = "Hide actions",
  className,
}: OverflowActionsProps) {
  const reduce = useReducedMotion();
  const canHover = useHoverCapable();
  const overflowId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef(0);
  const [open, setOpen] = useState(false);
  const transition = reduce ? { duration: 0 } : SHELL;

  const setExpanded = useCallback((v: boolean) => setOpen(v), []);

  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    if (!open) {
      node.style.left = `${leftRef.current - node.getBoundingClientRect().left}px`;
      return;
    }
    node.style.left = "";
    leftRef.current = node.getBoundingClientRect().left;
  }, [open]);

  const handle = (item: OverflowActionItem) => {
    item.onClick?.();
    onAction?.(item);
    if (collapseOnAction) setExpanded(false);
  };

  return (
    <motion.div layout transition={transition} className={cx("inline-flex", className)}>
      <motion.div
        layout
        transition={transition}
        className="relative inline-flex items-center gap-1 overflow-hidden rounded-full border border-line bg-ink-2 p-1 text-xs"
      >
        <motion.div layout transition={transition} className="inline-flex items-center gap-1">
          {primaryActions.map((item) => (
            <ActionButton key={item.id} item={item} reduce={reduce}
              onAction={handle} layoutTransition={transition} />
          ))}
        </motion.div>

        <AnimatePresence mode="popLayout" initial={false}>
          {open ? (
            <motion.div
              key="overflow"
              ref={wrapRef}
              id={overflowId}
              layout
              transition={transition}
              className="relative inline-flex w-max items-center gap-1"
            >
              {overflowActions.map((item) => (
                <ActionButton key={item.id} item={item} reduce={reduce}
                  variants={OVERFLOW_VARIANTS} onAction={handle} layoutTransition={transition} />
              ))}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <motion.button
          type="button"
          layout
          aria-expanded={open}
          aria-controls={open ? overflowId : undefined}
          aria-label={open ? closeLabel : openLabel}
          title={open ? closeLabel : openLabel}
          onClick={() => setExpanded(!open)}
          whileTap={reduce ? undefined : { scale: 0.96 }}
          whileHover={reduce || !canHover ? undefined : { scale: 1.05 }}
          transition={transition}
          className="relative inline-grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pitch text-emerald-950 outline-none focus-visible:ring-2 focus-visible:ring-pitch focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={open ? "close" : "open"}
              variants={ICON_VARIANTS}
              initial={reduce ? { opacity: 0 } : "hidden"}
              animate={reduce ? { opacity: 1 } : "visible"}
              exit={reduce ? { opacity: 0 } : "exit"}
              className="inline-grid place-items-center"
            >
              {open ? <CloseIcon /> : <MoreIcon />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </motion.div>
    </motion.div>
  );
}

function ActionButton({
  item, reduce, variants, onAction, layoutTransition,
}: {
  item: OverflowActionItem;
  reduce: boolean | null;
  variants?: Variants;
  onAction: (item: OverflowActionItem) => void;
  layoutTransition: Transition;
}) {
  const label = typeof item.label === "string" ? item.label : undefined;
  return (
    <motion.span
      layout="position"
      variants={variants}
      initial={variants ? (reduce ? { opacity: 0 } : "hidden") : undefined}
      animate={variants ? (reduce ? { opacity: 1 } : "visible") : undefined}
      exit={variants ? (reduce ? { opacity: 0 } : "exit") : undefined}
      whileTap={reduce || item.disabled ? undefined : { scale: 0.97 }}
      transition={layoutTransition}
      className="inline-flex shrink-0"
    >
      <button
        type="button"
        disabled={item.disabled}
        aria-label={item.ariaLabel}
        title={label}
        onClick={() => onAction(item)}
        className={cx(
          "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full bg-card px-3 font-medium outline-none transition",
          "focus-visible:ring-2 focus-visible:ring-pitch focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:opacity-45",
          item.danger ? "text-home hover:bg-home/10" : "text-slate-200 hover:bg-line",
        )}
      >
        {item.icon && <span className="inline-flex h-3.5 w-3.5 items-center justify-center">{item.icon}</span>}
        <span className="whitespace-nowrap">{item.label}</span>
      </button>
    </motion.span>
  );
}

export default OverflowActions;
