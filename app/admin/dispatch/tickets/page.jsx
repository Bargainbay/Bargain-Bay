import { redirect } from 'next/navigation';

// Service calls moved onto the dispatch page itself — everything dispatch needs
// lives on one screen. This route stays so older links still land somewhere
// sensible rather than 404ing.
export default function TicketsRedirect() {
  redirect('/admin/dispatch?view=tickets');
}
