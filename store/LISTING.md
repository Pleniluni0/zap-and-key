# Ficha de la Chrome Web Store — Zap & Key

## Nombre
Zap & Key

## Resumen / descripción corta (máx. 132 caracteres)
Oculta elementos molestos, asigna teclas a botones y lee cómics con autoscroll y autoavance. Todo se guarda en local.

## Categoría
Productividad (alternativa: Accesibilidad)

## Idioma principal
Español

## Descripción larga

Zap & Key te ayuda a leer cómics y manga online sin distracciones.

⚡ ZAP MODE — OCULTA LO QUE MOLESTA
Haz clic en cualquier elemento de la página (anuncios, banners, popups, barras) y desaparece. Se recuerda por dominio: vuelves a la web y sigue oculto. Con botón de deshacer, pausa por dominio y soporte para webs dinámicas (React/Vue) y Shadow DOM.

⌨️ KEY BIND — TECLAS PARA BOTONES
Elige un botón o enlace (por ejemplo "Siguiente"), pulsa una tecla y listo: a partir de ahora esa tecla hace clic por ti. Los atajos no se activan mientras escribes en un campo de texto.

🤖 MODO AUTO — LECTURA SIN MANOS
Desplazamiento automático con 5 velocidades. Al llegar al final espera los segundos que elijas y pulsa el botón "Siguiente" con tu atajo. En la página nueva continúa solo. Atajo propio para activarlo y desactivarlo.

📖 HISTORIAL DE LECTURA
Detecta la serie y el capítulo por la URL y el título, y solo registra páginas que parecen un lector de cómics. Retoma donde lo dejaste con un clic. Puedes bloquear o forzar el registro por dominio y borrar entradas cuando quieras.

💾 TUS DATOS, EN TU NAVEGADOR
Reglas, atajos, configuración e historial se guardan en tu navegador. Sin cuentas, sin servidores, sin analíticas. Exporta e importa una copia de seguridad en JSON.

Atajo global: Alt+X activa y desactiva Zap Mode (reasignable en chrome://extensions/shortcuts).

Código abierto (MIT): https://github.com/Pleniluni0/zap-and-key

## Finalidad única (campo "Single purpose")
Mejorar la lectura de cómics y manga en la web: ocultar elementos de página, asignar teclas a botones, desplazamiento automático y seguimiento de lectura, con los datos guardados localmente.

## Justificación de permisos (pestaña Privacidad)

- **storage:** guarda localmente las reglas de ocultación, atajos, configuración del modo Auto y el historial de lectura del usuario.
- **activeTab:** permite al popup y al atajo de teclado (Alt+X) activar los modos Zap y Key Bind en la pestaña activa.
- **Permiso de host / content script en todas las URL (<all_urls>):** las funciones deben ejecutarse en cualquier web de cómics que el usuario elija; no existe una lista fija de dominios. El script solo actúa en el navegador (oculta elementos, dispara los atajos del usuario, desplaza la página y detecta capítulo/serie) y no transmite nada.
- **Código remoto:** No. Todo el código está incluido en el paquete.

## Prácticas de datos (formulario "Privacy practices")
- Datos tratados: **Historial web** (URL y título de páginas de lectura reconocidas) y **Contenido del sitio web** (selectores y etiquetas de botones).
- Uso: solo para el funcionamiento de la extensión; guardado local; no se transmite, no se vende, no se usa para publicidad ni crédito.
- Marcar las 3 certificaciones de uso limitado.
- URL de política de privacidad: publicar PRIVACY.md (p. ej. https://github.com/Pleniluni0/zap-and-key/blob/main/PRIVACY.md tras hacer push, o GitHub Pages).

## Capturas necesarias
1280×800 (o 640×400), mínimo 1, recomendado 3–5:
1. Zap Mode: elemento resaltado en rojo y toast "Elemento eliminado — Deshacer".
2. Key Bind: overlay "Pulse una tecla para asignar".
3. Pestaña Auto del popup con la cuenta atrás.
4. Pestaña Historial agrupada por dominio.
Opcional: imagen promocional pequeña 440×280.

## Notas de revisión (campo opcional para el revisor)
La extensión no realiza peticiones de red. Para probarla: abrir cualquier web, pulsar el icono → "Activar Zap Mode" y hacer clic en un elemento (se oculta; "Deshacer" lo restaura). "Activar Key Bind Mode" → clic en un botón → pulsar una tecla.
