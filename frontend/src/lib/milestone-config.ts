import { Circle, Clock, CheckCircle2, AlertCircle } from "lucide-react";

export const MILESTONE_STATUS = {
  pending: {
    label: "Pending",
    icon: Circle,
    color: "text-accent-orange",
    bg: "bg-accent-orange/10",
  },
  verifying: {
    label: "Verifying",
    icon: Clock,
    color: "text-accent-blue",
    bg: "bg-accent-blue/10",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    color: "text-accent-green",
    bg: "bg-accent-green/10",
  },
  failed: {
    label: "Failed",
    icon: AlertCircle,
    color: "text-accent-red",
    bg: "bg-accent-red/10",
  },
  disputed: {
    label: "Disputed",
    icon: AlertCircle,
    color: "text-accent-purple",
    bg: "bg-accent-purple/10",
  },
} as const;

export const PAYMENT_TYPE_CONFIG = {
  immediate: {
    label: "Immediate",
    color: "text-accent-green",
    bg: "bg-accent-green/10",
    border: "border-accent-green/20",
  },
  escrow: {
    label: "Escrow",
    color: "text-accent-blue",
    bg: "bg-accent-blue/10",
    border: "border-accent-blue/20",
  },
  conditional: {
    label: "Conditional",
    color: "text-accent-orange",
    bg: "bg-accent-orange/10",
    border: "border-accent-orange/20",
  },
} as const;

export const OUTCOME_CONFIG = {
  passed: {
    label: "Passed",
    color: "text-accent-green",
    bg: "bg-accent-green/10",
    border: "border-accent-green/30",
  },
  failed: {
    label: "Failed",
    color: "text-accent-red",
    bg: "bg-accent-red/10",
    border: "border-accent-red/30",
  },
  disputed: {
    label: "Disputed",
    color: "text-accent-orange",
    bg: "bg-accent-orange/10",
    border: "border-accent-orange/30",
  },
} as const;
