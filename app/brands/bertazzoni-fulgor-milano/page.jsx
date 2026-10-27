import { redirect } from 'next/navigation';

// The first version of the premium page was just these two makes; it is /premium now.
export default function Old() { redirect('/premium'); }
