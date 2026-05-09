import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { env } from '../config/env.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(env.TZ);

export const getNow = () => dayjs().tz();
export function getTodayStr(): string {
  const now = dayjs().tz(env.TZ);
  // Jika sekarang sebelum jam 3 pagi, anggap masih hari kemarin
  if (now.hour() < 3) {
    return now.subtract(1, 'day').format('YYYY-MM-DD');
  }
  return now.format('YYYY-MM-DD');
}

export { dayjs };
