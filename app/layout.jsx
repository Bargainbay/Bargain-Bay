import './globals.css';
import Header from '../components/Header';
import Footer from '../components/Footer';

export const metadata = {
  title: 'Bargain Bay — Liquidation Appliances | Hamilton, ON',
  description:
    'Name-brand appliances. Tested. Up to 60% off retail. Local pickup or delivery in Hamilton & area. HST included at checkout.',
  icons: { icon: '/favicon.png' }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="wrap">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
