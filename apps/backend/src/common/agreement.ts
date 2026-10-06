import { isoDate, todayLocal } from './dates';

export type AgreementStatus = 'VALID' | 'EXPIRED' | 'NOT_STARTED' | 'NONE';

const DAY = 86_400_000;

/**
 * Rental agreement validity on today's India date. The end date itself is still valid; without a start date
 * the agreement counts as started. No end date means there is nothing to show.
 */
export function agreementInfo(a: { agreementStartDate: Date | null; agreementEndDate: Date | null }, today = todayLocal()) {
  const start = a.agreementStartDate;
  const end = a.agreementEndDate;
  const status: AgreementStatus = !end ? 'NONE' : today > end ? 'EXPIRED' : start && today < start ? 'NOT_STARTED' : 'VALID';
  return {
    agreementStartDate: start ? isoDate(start) : null,
    agreementEndDate: end ? isoDate(end) : null,
    agreementStatus: status,
    agreementDaysLeft: end ? Math.round((end.getTime() - today.getTime()) / DAY) : null,
  };
}
