import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone.js';
import utc from 'dayjs/plugin/utc.js';
import { env } from '../config/env.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.tz.setDefault(env.TZ);

export const getNow = () => dayjs().tz();
export function getTodayStr(): string {
  return dayjs().tz(env.TZ).format('YYYY-MM-DD');
}

export function getYesterdayStr(): string {
  return dayjs().tz(env.TZ).subtract(1, 'day').format('YYYY-MM-DD');
}

export { dayjs };
