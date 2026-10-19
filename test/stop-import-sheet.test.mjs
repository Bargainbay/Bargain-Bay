// A client's sheet with a price column, a services column and "after 5PM" in it.
import { suite, test, equal } from './_harness.mjs';
import { guessMapping, toJobs, parseMoney, splitCityProvince, readServiceText, normalizeDateCell } from '../lib/stop-import.js';

suite('stop import — price, services, window');
{
  const headers = ['What we are charging', 'Delivery Date', 'Invoice #', 'Customer Name', 'Product Description', 'Services', 'Address', 'City', 'Postal code', 'Phone Number', 'Notes'];
  const row = ['125', '46314.0', '2023122720', 'Nathan Joseph', 'Midea fridge', 'Drop Off, Haul Away Delivery After 5PM', '44 Hunsberger Drive', 'Baden, Ontario', 'N4A 3S5', '519 580 7742', ''];

  test('price column maps and lands on the job', () => {
    const [{ job }] = toJobs([row], guessMapping(headers), {});
    equal(job.chargeAmount, 125);
  });
  test('haul away, shipment type and window come off the services cell', () => {
    const [{ job }] = toJobs([row], guessMapping(headers), {});
    equal(job.services.includes('haul_away'), true);
    equal(job.shipmentType, 'threshold');
    equal(job.windowStart, '17:00');
  });
  test('city and province are split; Excel serial with a decimal is a date', () => {
    const [{ job }] = toJobs([row], guessMapping(headers), {});
    equal(job.city, 'Baden');
    equal(job.jobDate, '2026-10-19');
    equal(normalizeDateCell('46314.0'), '2026-10-19');
  });
  test('helpers', () => {
    equal(parseMoney('$1,250.50'), 1250.5);
    equal(parseMoney('call'), null);
    equal(splitCityProvince('New Hamburg, Ontario').city, 'New Hamburg');
    equal(readServiceText('Drop Off, Room Of Choice').shipmentType, 'white_glove');
  });
}
