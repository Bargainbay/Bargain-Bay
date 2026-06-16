'use client';
import { useEffect } from 'react';
import { viewContent } from '../lib/fpixel';

// Fires ViewContent on a product page. content_ids = the unit SKU.
export default function PixelView({ id, name, value }) {
  useEffect(() => { viewContent({ id, name, value }); }, [id]);
  return null;
}
