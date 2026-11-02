import './globals.css';

export const metadata = {
  title: 'Vision-Tax Portal',
  icons: { icon: '/assets/images/favicon.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
        {/* Apply the saved theme before first paint to avoid a light-theme flash */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('vt-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}" }} />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
