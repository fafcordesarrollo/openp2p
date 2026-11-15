	// SERVIDOR WEBSOCKET
	const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
	const ws = new WebSocket(`${protocol}//${window.location.host}`);

	const listaUsuariosConectados = document.getElementById('lista-usuarios-conectados');
	
	const chatInputField = document.getElementById('chatInputField'); 
	const sendChatBtn = document.getElementById('sendChatBtn');
	
	let nombreUsuario = localStorage.getItem('chatP2PNombre') || "Creador";
	let fotoUsuario = localStorage.getItem('chatP2PFoto') || '';
	let miId = null; 
	
	let usuarioDestinoId = null;
	let peerConnection = null;
	let dataChannel = null;
	let chunksRecibidos = [];
	let infoArchivoRecibiendo = null;
	let bytesRecibidos = 0;
	let fotosUsuarios = {};
	
	let grupoSeleccionadoId = null;
	let gruposGlobales = [];
	
	// GESTIӎ MULTICHAT Y NOTIFICACIONES
	let idUsuarioChateando = null;
	let historialChats = {};  
	let nombresUsuarios = {}; 
	let mensajesNoLeidos = {}; 
	let ultimosMovimientos = {}; 


	// Se ejecuta exactamente cuando la conexi󮠳e establece con 鸩to
	ws.onopen = () => {
		const nombreUsuario = localStorage.getItem('chatP2PNombre');
		ws.send(JSON.stringify({ tipo: "conectar", nombre: nombreUsuario }));
	};

	ws.onmessage = async (event) => {
		const datos = JSON.parse(event.data);
		console.log('ws','onmessage');

		// 1. Asignaci󮠤e ID propio
		if (datos.tipo === 'tu-id') {
			miId = datos.id;
			nombreUsuario = localStorage.getItem('chatP2PNombre');
			fotoUsuario = localStorage.getItem('chatP2PFoto') || '';
			const inicial = nombreUsuario ? nombreUsuario.charAt(0).toUpperCase() : '';

			if (nombreUsuario) {
				const avatarHTML = fotoUsuario 
					? `<img src="${fotoUsuario}" class="avatar-lista" alt="Avatar">` 
					: `<span class="avatar-inicial">${inicial}</span>`;
				document.getElementById('mi-id').innerHTML = `${avatarHTML} <span class="usuario-nombre">${nombreUsuario}</span>`;
			} else {
				document.getElementById('mi-id').innerText = miId;
			}
			activarme();
			return;
		}

		// 2. EL ESCUDO INTEGRO: Si est᳠desconectado, limpia el div derecho y el izquierdo
		if (!estoyActivo) {
			document.getElementById('lista-usuarios-conectados').innerHTML = '';
			document.getElementById('lista-grupos-conectados').innerHTML = '';
			return; 
		}

		// 3. Recepción de actualización global del servidor (CORREGIDO)
		if (datos.tipo === 'lista-usuarios') {
			const gruposNuevos = datos.grupos || [];
			
			// Inyectamos nuestros contadores de no leídos locales en el array que acaba de mandar el servidor
			gruposNuevos.forEach(grupo => {
				grupo.mensajesNoLeidos = mensajesNoLeidos[grupo.id] || 0;
			});

			gruposGlobales = gruposNuevos;
			window.usuariosActivosRed = datos.usuarios || [];
			
			actualizarListaGrupos(gruposGlobales);
			actualizarParticipantesGrupoActual();
		}

		// El servidor me confirma que mi grupo ha sido creado, procedo a auto-seleccionarlo
		if (datos.tipo === 'grupo-creado-exito') {
			seleccionarGrupo(datos.grupoId, datos.descripcion, true);
			return;
		}

		// 4. Recepción de mensajes de grupo (CORREGIDO)
		if (datos.tipo === 'recibir-mensaje-grupo') {
			const salaId = datos.grupoId;
			const ahora = new Date();
			const fechaHoraActual = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			
			// Si el mensaje es de otra persona, lo guardamos en nuestro historial local en memoria
			if (datos.desdeId !== miId) {
				if (!historialChats[salaId]) {
					historialChats[salaId] = [];
					mensajesNoLeidos[salaId] = 0;
				}
				historialChats[salaId].push({ 
					remitente: 'other', 
					texto: datos.texto,
					nombre: datos.desdeNombre || "Usuario",
					hora: fechaHoraActual
				});
			}
			
			if (grupoSeleccionadoId !== salaId) {
				// Si estás en otra sala, incrementas las alertas de no leídos
				if (datos.desdeId !== miId) {
					// 1. Incrementamos el contador local en el objeto de pendientes
					mensajesNoLeidos[salaId] = (mensajesNoLeidos[salaId] || 0) + 1;
					
					// 2. Buscamos el grupo en nuestro array global de la app para asegurar la reactividad
					const grupoModificar = gruposGlobales.find(g => g.id === salaId);
					if (grupoModificar) {
						// Sincronizamos el total de no leídos antes de repintar la barra lateral izquierda
						grupoModificar.mensajesNoLeidos = mensajesNoLeidos[salaId];
					}

					reproducirSonidoNotificacion();
					
					// 3. Renderizamos la lista de grupos reflejando el nuevo número en la burbuja
					actualizarListaGrupos(gruposGlobales);
				}
			} else {
				// SÓLO pintamos el globo en la pantalla si el mensaje proviene de OTRA persona
				if (datos.desdeId !== miId) {
					const container = document.getElementById('chatMessagesContainer');
					if (container) {
						// 🌟 CORRECCIÓN: Si todavía está el cartel informativo de bienvenida, lo fulminamos antes de pintar
						const mensajeBienvenida = container.querySelector('.subtitle');
						if (mensajeBienvenida || container.innerText.includes("Sala unida")) {
							container.innerHTML = ''; 
						}
						
						const mBox = crearGloboMensaje('other', datos.desdeNombre, datos.texto, fechaHoraActual);
						container.appendChild(mBox);
						hacerScrollAlFinal();
					}
				}
			}
		}

		// 5. Recepci󮠤e mensajes individuales (Mantenido)
		if (datos.tipo === 'recibir-mensaje') {
			const autorId = datos.desdeId;
			const ahora = new Date();
			const fechaHoraActual = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
			ultimosMovimientos[autorId] = Date.now();
			
			if (!historialChats[autorId]) {
				historialChats[autorId] = [];
				nombresUsuarios[autorId] = (datos.desdeNombre && datos.desdeNombre !== "Creador") ? datos.desdeNombre : null;
				mensajesNoLeidos[autorId] = 0;
			}
			historialChats[autorId].push({ 
				remitente: 'other', 
				texto: datos.texto,
				nombre: datos.desdeNombre || nombresUsuarios[autorId] || "Usuario",
				hora: fechaHoraActual
			});
			
			if (idUsuarioChateando !== autorId) {
				mensajesNoLeidos[autorId] = (mensajesNoLeidos[autorId] || 0) + 1;
				reproducirSonidoNotificacion();
			}
			if (idUsuarioChateando === autorId) {
				const mBox = crearGloboMensaje('other', datos.desdeNombre, datos.texto, fechaHoraActual);
				chatMessagesContainer.appendChild(mBox);
				hacerScrollAlFinal();
			}
		}
		

// CASO A: Alguien se ha unido y el servidor me pide a MÍ que le comparta mis mensajes guardados
if (datos.tipo === 'solicitar-historial-grupo') {
    const salaId = datos.grupoId;
    // Extraemos nuestros mensajes locales guardados en la memoria de nuestro navegador
    const misMensajesLocales = historialChats[salaId] || [];
    
    // Se los enviamos de vuelta al servidor para que se los entregue al solicitante
    ws.send(JSON.stringify({
        tipo: 'transferir-historial-grupo',
        grupoId: salaId,
        solicitanteId: datos.solicitanteId,
        mensajes: misMensajesLocales
    }));
}

// CASO B: Yo soy el usuario nuevo y recibo los mensajes pasados de otro compañero (CORREGIDO)
if (datos.tipo === 'recibir-historial-p2p') {
    const salaId = datos.grupoId;
    const mensajesRecibidos = datos.mensajes || [];
    
    // Inicializamos el historial local de esta sala vacío
    historialChats[salaId] = [];
    
    // Evaluamos cada mensaje antes de guardarlo en nuestra memoria
    mensajesRecibidos.forEach(m => {
        // CORRECCIÓN CLAVE: 
        // Si el mensaje tiene tu mismo nombre, eres tú ('me'). Si tiene otro nombre, es de otra persona ('other').
        const remitenteReal = (m.nombre === nombreUsuario) ? 'me' : 'other';
        
        historialChats[salaId].push({
            remitente: remitenteReal, // Guardamos la perspectiva correcta para este usuario
            texto: m.texto,
            nombre: m.nombre,
            hora: m.hora
        });
    });
    
    // Si tenemos esa misma sala abierta en este instante, pintamos los mensajes en pantalla
    if (grupoSeleccionadoId === salaId) {
        const container = document.getElementById('chatMessagesContainer');
        container.innerHTML = ''; // Limpiamos el texto de bienvenida por defecto
        
        if (historialChats[salaId].length === 0) {
            container.innerHTML = `<p class="subtitle">Sala unida. Comienza a enviar mensajes.</p>`;
        } else {
            historialChats[salaId].forEach(m => {
                const mBox = crearGloboMensaje(m.remitente, m.nombre, m.texto, m.hora);
                container.appendChild(mBox);
            });
        }
        hacerScrollAlFinal();
    }
}

		// Recepción de alertas de sistema 
		if (datos.tipo === 'recibir-notificacion-sistema') {
			
			const salaId = datos.grupoId;
			/* OJO 
			const ahora = new Date();
			const fechaHoraActual = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

			// 1. Guardamos la notificación en el historial en memoria para que no se pierda si cambias de pestaña
			if (!historialChats[salaId]) {
				historialChats[salaId] = [];
			}
			historialChats[salaId].push({ 
				remitente: 'sistema', 
				texto: datos.texto,
				hora: fechaHoraActual
			});
			*/
			
			// 2. Si el usuario tiene abierta esa misma sala en pantalla ahora mismo, la pintamos al instante
			if (grupoSeleccionadoId === salaId) {
				const container = document.getElementById('chatMessagesContainer');
				if (container) {
					// Limpiamos el cartel de bienvenida si todavía existiera
					const mensajeBienvenida = container.querySelector('.subtitle');
					if (mensajeBienvenida || container.innerText.includes("Sala unida")) {
						container.innerHTML = ''; 
					}

					const mBox = crearGloboNotificacionSistema(datos.texto);
					container.appendChild(mBox);
					hacerScrollAlFinal();
				}
			}
			return;
		}
		
		// El creador ha destruido la sala donde yo estaba chateando o visualizando
		if (datos.tipo === 'grupo-destruido-por-creador') {
			const salaId = datos.grupoId;
			
			// 1. Eliminamos historiales obsoletos
			if (historialChats[salaId]) delete historialChats[salaId];
			if (mensajesNoLeidos[salaId]) delete mensajesNoLeidos[salaId];

			// 2. Si el usuario actual tenía esta sala seleccionada, lo sacamos al estado base de la app
			if (grupoSeleccionadoId === salaId) {
				grupoSeleccionadoId = null; 
				
				const container = document.getElementById('chatMessagesContainer');
				if (container) {
					container.innerHTML = '<p class="subtitle" style="color: #dc3545; font-style: italic;">El grupo activo ha sido cerrado por su creador.</p>';
				}

				const tituloGrupoHeader = document.querySelector('.columna-central h2') || document.getElementById('chat-directo'); 
				if (tituloGrupoHeader) {
					tituloGrupoHeader.innerText = 'Selecciona un grupo para comenzar';
				}
				
				const inputChat = document.getElementById('chatInputField') || document.getElementById('input-mensaje-chat');
				const botonEnviar = document.getElementById('sendChatBtn') || document.getElementById('btn-enviar-mensaje');
				if (inputChat) {
					inputChat.value = '';
					inputChat.disabled = true;
					inputChat.placeholder = 'Selecciona un grupo para escribir...';
				}
				if (botonEnviar) botonEnviar.disabled = true;

				const contenedorParticipantes = document.getElementById('lista-usuarios-conectados');
				if (contenedorParticipantes) {
					contenedorParticipantes.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">Selecciona un grupo para ver quién está participando.</p>';
				}
			}
			
			// 3. Forzamos el redibujado inmediato de las barras laterales con los datos frescos del sistema
			actualizarListaGrupos(gruposGlobales);
			return;
		}
		
		// ?? NUEVO: El creador te ha expulsado y bloqueado de la sala actual
		if (datos.tipo === 'expulsado-del-grupo') {
			alert(`Has sido expulsado y bloqueado del grupo: ${datos.descripcion}`);
			
			// Si el usuario tenía esa sala abierta en pantalla, forzamos el desahucio visual inmediato
			if (grupoSeleccionadoId === datos.grupoId) {
				grupoSeleccionadoId = null;
				
				document.getElementById('chatInputField').disabled = true;
				document.getElementById('chatInputField').placeholder = "Has sido bloqueado de este grupo.";
				document.getElementById('chat-directo').innerText = "Sala de Chat";
				document.getElementById('chatMessagesContainer').innerHTML = '<p class="subtitle" style="color: #ef4444; font-style: italic;">Fuiste expulsado o expulsada de este grupo.</p>';
				
				const contenedorParticipantes = document.getElementById('lista-usuarios-conectados');
				if (contenedorParticipantes) {
					contenedorParticipantes.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">Selecciona un grupo para ver quién está participando.</p>';
				}
			}
			
			// Purgamos sus cachés locales de ese chat específico por privacidad
			if (historialChats[datos.grupoId]) delete historialChats[datos.grupoId];
			if (mensajesNoLeidos[datos.grupoId]) delete mensajesNoLeidos[datos.grupoId];
			
			actualizarListaGrupos(gruposGlobales);
			return;
		}

		// Alertas de error del sistema (ej: intentar unirse estando bloqueado)
		if (datos.tipo === 'error-unirse-grupo') {
			console.log('expulsado',datos);
			alert(`ATENCIÓN\n${datos.mensaje}`);
			return;
		}

		

	};

	// DETECTAR SI EL SERVIDOR SE CAE O SE PIERDE LA RED
	ws.onclose = () => {
		mostrarMensaje("Sistema", "Conexión el servidor perdida.");
		if (estoyActivo) {
			const boton = document.querySelector("#usuarios button");
			const miIdSpan = document.getElementById('mi-id');

			boton.innerText = "Aparecer en línea";
			boton.style.backgroundColor = "var(--primary)";
			miIdSpan.style.color = "var(--primary)";
			estoyActivo = false;

			// Limpiamos los dos div de la interfaz al desconectar
			document.getElementById('lista-usuarios-conectados').innerHTML = '';
			document.getElementById('lista-grupos-conectados').innerHTML = '';
			
			document.getElementById('chatMessagesContainer').innerText = "Servidor desconectado";
			usuarioDestinoId = null;
			if (peerConnection) {
				peerConnection.close();
				peerConnection = null;
			}
		}
		localStorage.removeItem('chatP2PNombre');
		localStorage.removeItem('chatP2PFoto');
		window.location.replace('index.html');
	};


	function hacerScrollAlFinal() {
		// 1. Obtenemos el contenedor usando el ID de tu c󤩧o HTML
		const contenedorChat = document.getElementById("chatMessagesContainer");
		
		if (contenedorChat) {
			// 2. Modificamos la barra para que baje hasta la altura total del contenido
			contenedorChat.scrollTop = contenedorChat.scrollHeight;
		}
	}
	
	function actualizarListaDeChatsHTML() {
		// 1. Apuntamos al contenedor HTML correcto de tu sidebar
		const contenedor = document.getElementById('lista-usuarios-conectados');
		if (!contenedor) return;
		contenedor.innerHTML = '';

		// 2. Usamos la lista de usuarios que el servidor mantiene activos
		const usuarios = window.usuariosActivosRed || [];

		usuarios.forEach(u => {
			// No te muestres a ti mismo en la lista
			if (u.id === miId) return;

			// Guardamos/actualizamos datos de apoyo en tus objetos globales
			nombresUsuarios[u.id] = u.nombre;
			fotosUsuarios[u.id] = u.foto || ''; 

			// Estructurar el elemento visual
			const item = document.createElement('div');
			item.setAttribute('data-user-id', u.id);

			// 3. LÓGICA DE SELECCIÓN (Borde verde y bloqueo de clics)
			if (u.id === idUsuarioChateando) {
				item.className = `usuario-item seleccionado`;
				item.style.pointerEvents = "none"; // Bloquea los clics en el chat activo
			} else {
				item.className = `usuario-item`;
				item.addEventListener('click', () => cambiarDeChat(u.id)); // Clic normal para los demás
			}
			
			// 4. Extraer la inicial del nombre del contacto evaluado (u.nombre), NO el tuyo
			const fotoUsuario = u.foto || ''; 
			const inicial = u.nombre ? u.nombre.charAt(0).toUpperCase() : 'U';
			
			const avatarHTML = fotoUsuario
				? `<img src="${fotoUsuario}" class="avatar-lista" alt="Avatar">` 
				: `<span class="avatar-inicial">${inicial}</span>`;

			// 5. CORREGIDO: Forzamos la sincronización de la propiedad en el objeto u para blindar el renderizado reactivo
			const numNoLeidos = mensajesNoLeidos[u.id] || 0;
			u.mensajesNoLeidos = numNoLeidos; 

			// Cambiado el color de fondo a var(--accent-red) o #fe3c72 para unificar el diseño visual con la app
			const globoAlerta = numNoLeidos > 0 
				? `<span style="background-color: #fe3c72; color: white; border-radius: 50%; padding: 2px 7px; font-size: 0.75rem; font-weight: bold; margin-left: auto; flex-shrink: 0; display: inline-block;">${numNoLeidos}</span>` 
				: '';
				
			// Ensamblar la fila con Flexbox para que el globo rojo se alinee a la derecha de forma limpia
			item.style.display = "flex";
			item.style.alignItems = "center";
			item.style.gap = "10px";
			item.style.width = "100%";
			item.style.boxSizing = "border-box";

			item.innerHTML = `${avatarHTML} <span class="usuario-nombre" style="flex-grow: 1;">${u.nombre}</span> ${globoAlerta}`;
			
			contenedor.appendChild(item);
		});
	}
	

	function actualizarListaUsuarios(usuarios) {
		// 1. Guardamos la lista en una variable global para poder repintarla desde cambiarDeChat()
		window.usuariosActivosRed = usuarios; 

		// 2. Apuntamos al contenedor HTML correcto de tu barra lateral
		const contenedor = document.getElementById('lista-usuarios-conectados');
		if (!contenedor) return;
		contenedor.innerHTML = '';

		// --- PASO A: FILTRARNOS A NOSOTROS MISMOS PRIMERO ---
		// As𙑶itamos que tu propio usuario influya en la ordenaci󮠯 rompa la lista
		const otrosUsuarios = usuarios.filter(u => u.id !== miId);

		// --- PASO B: ORDENACIӎ INTELIGENTE (WhatsApp Style) ---
		const usuariosOrdenados = otrosUsuarios.sort((a, b) => {
			// REGLA 1: El usuario con el que estoy hablando se queda fijo arriba del todo ??
			if (a.id === idUsuarioChateando) return -1;
			if (b.id === idUsuarioChateando) return 1;

			// REGLA 2: Los dem᳠se ordenan por su última actividad (el m᳠reciente arriba)
			const tiempoA = ultimosMovimientos[a.id] || 0;
			const tiempoB = ultimosMovimientos[b.id] || 0;

			return tiempoB - tiempoA; // El número de milisegundos m᳠grande va arriba
		});

		// 3. Recorremos tu array YA FILTRADO Y ORDENADO utilizando exactamente tu l󧩣a original
		usuariosOrdenados.forEach(u => {
			// Guardamos los datos de apoyo para la gesti󮠤e mensajes de chat
			nombresUsuarios[u.id] = u.nombre;
			fotosUsuarios[u.id] = u.foto || ''; 

			const div = document.createElement('div');
			div.setAttribute('data-user-id', u.id);

			if (u.id === idUsuarioChateando) {
				div.className = `usuario-item seleccionado`;
				div.style.pointerEvents = "none"; // Bloquea los clics en el chat activo
			} else {
				div.className = `usuario-item`;
				div.onclick = () => {
					// Actualizamos su tiempo al hacerle clic para asegurar su posici󮍊					
					// ultimosMovimientos[u.id] = Date.now();
					cambiarDeChat(u.id); 
				};
			}
			
			// GENERACIӎ DEL AVATAR: Extrae la inicial del nombre del contacto (u.nombre)
			const fotoUsuario = u.foto || '';
			const inicial = u.nombre ? u.nombre.charAt(0).toUpperCase() : 'U';
			const avatarHTML = fotoUsuario
				? `<img src="${fotoUsuario}" class="avatar-lista" alt="Avatar">` 
				: `<span class="avatar-inicial">${inicial}</span>`;

			// GLOBO ROJO DE NO LË́OS: Si tiene mensajes acumulados, dibuja la alerta
			const numNoLeidos = mensajesNoLeidos[u.id] || 0;
			const globoAlerta = numNoLeidos > 0 
				? `<span style="background-color: #fe3c72; color: white; border-radius: 50%; padding: 2px 7px; font-size: 0.75rem; font-weight: bold; margin-left: auto; flex-shrink: 0;">${numNoLeidos}</span>` 
				: '';
				
			// Estilos de alineaci󮠆lexbox para que el globo rojo se vaya al extremo derecho
			div.style.display = "flex";
			div.style.alignItems = "center";
			div.style.gap = "10px";
			div.style.width = "100%";
			div.style.boxSizing = "border-box";

			// Ensamblar todo el HTML del contacto exactamente como lo ten𬰍
			div.innerHTML = `${avatarHTML} <span class="usuario-nombre" style="flex-grow: 1;">${u.nombre}</span> ${globoAlerta}`;
			
			contenedor.appendChild(div);
		});
	}


function crearGloboMensaje(remitente, nombre, texto, fechaHora) {
	const mBox = document.createElement('div');
	mBox.className = `msg ${remitente}`;
	
	// 1. Marca de tiempo
	const timeSpan = document.createElement('span');
	timeSpan.className = 'chat-time';
	
	if (fechaHora) {
		timeSpan.textContent = fechaHora;
	} else {
		const ahora = new Date();
		const hora = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });  
		timeSpan.textContent = `${hora}`;
	}
	
	// 2. Nombre del usuario
	const nameSpan = document.createElement('strong');
	nameSpan.className = 'chat-author';
	nameSpan.textContent = remitente === 'me' ? "Tú: " : `${nombre || "Usuario"}: `;
	
	mBox.appendChild(timeSpan);
	mBox.appendChild(nameSpan);

	// 3. Detectar si es Nota de Voz o Texto normal
	if (typeof texto === 'string' && texto.startsWith('AUDIO_VOICE::')) {
		const audioSrc = texto.replace('AUDIO_VOICE::', '');
		const audioEl = document.createElement('audio');
		audioEl.controls = true;
		audioEl.src = audioSrc;
		audioEl.className = 'chat-audio-player';
		mBox.appendChild(audioEl);
	} else {
		const textSpan = document.createElement('span');
		textSpan.className = 'chat-text';
		textSpan.textContent = texto; 
		mBox.appendChild(textSpan);
	}
	
	return mBox;
}
	
	/* OJO
	function crearGloboMensaje(remitente, nombre, texto, fechaHora) {
		const mBox = document.createElement('div');
		mBox.className = `msg ${remitente}`;
		
		// 1. Marca de tiempo (Fecha y Hora) -> Irᠡrriba a la derecha []
		const timeSpan = document.createElement('span');
		timeSpan.className = 'chat-time';
		
		if (fechaHora) {
			timeSpan.textContent = fechaHora;
		} else {
			const ahora = new Date();
			const fecha = ahora.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: '2-digit' }); 
			const hora = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });  
			// OJO timeSpan.textContent = `${fecha} ${hora}`;
			timeSpan.textContent = `${hora}`;
		}
		
		// 2. Nombre del usuario
		const nameSpan = document.createElement('strong');
		nameSpan.className = 'chat-author';
		nameSpan.textContent = remitente === 'me' ? "Tú: " : `${nombre || "Usuario"}: `;
		
		// 3. Texto del mensaje 
		const textSpan = document.createElement('span');
		textSpan.className = 'chat-text';
		textSpan.textContent = texto; 
		
		// Unimos las piezas dentro del globo
		mBox.appendChild(timeSpan);  // La fecha va primero para que el CSS la posicione
		mBox.appendChild(nameSpan);  // El nombre arriba a la izquierda
		mBox.appendChild(textSpan);  // El texto del mensaje abajo
		
		return mBox;
	}
	*/

	// CONMUTADOR DE CONVERSACIONES: Limpia alertas al abrir el chat
	function cambiarDeChat(idDestino) {
		console.log('accion','cambiardechat',idDestino);
		idUsuarioChateando = idDestino;
		
		// 1. Al abrir este chat, eliminamos el globo rosa (mensajes no le񛱳 a 0)
		mensajesNoLeidos[idDestino] = 0;
		
		// 2. Actualizamos el t񝑬o de la cabecera del chat con el nombre correcto
		const nombreAMostrar = nombresUsuarios[idDestino] || 'Usuario';
		chatMessagesContainer.textContent = `Chat con ${nombreAMostrar}`; 
		
		// DESBLOQUEAR CAMPOS F͓ICOS
		document.getElementById('chatInputField').disabled = false;
		document.getElementById('chatInputField').placeholder = "Escribe...";
		document.getElementById('chatInputField').focus();
		document.getElementById('sendChatBtn').disabled = false;
				
		chatMessagesContainer.innerHTML = '';
		if (nombreAMostrar) document.getElementById("chat-directo").innerHTML='Chateando con <span style="color: var(--primary);">'+nombreAMostrar+'</span>';
		else document.getElementById("chat-directo").innerHTML='Chat Directo';
		
		
		/* OJO 
		if (historialChats[idDestino]) {
			historialChats[idDestino].forEach(msg => {
				const mBox = document.createElement('div');
				mBox.className = `msg ${msg.remitente}`; // Serᠧmsg me' o 'msg other'
				
				// --- NUEVA LӇICA COMPATIBLE CON NOMBRES ---
				// 1. Creamos la etiqueta en negrita para el nombre
				const nameSpan = document.createElement('strong');
				
				// Decidimos qu頮ombre poner según qui鮠envi󠥬 mensaje
				if (msg.remitente === 'me') {
					nameSpan.textContent = (nombreUsuario || "Creador") + ": ";
				} else {
					// Usamos el nombre guardado en el historial, o el global, o 'Usuario' de plan B
					nameSpan.textContent = (msg.nombre || nombreAMostrar) + ": ";
				}
				
				// 2. Creamos la etiqueta para el texto del mensaje
				const textSpan = document.createElement('span');
				textSpan.textContent = msg.texto;
				
				// 3. Los inyectamos de forma segura en el contenedor del mensaje
				mBox.appendChild(nameSpan);
				mBox.appendChild(textSpan);
				// -------------------------------------------
				
				chatMessagesContainer.appendChild(mBox); 
			});
		}
		*/
		if (historialChats[idDestino]) {
			historialChats[idDestino].forEach(msg => {
				const nombreAMostrar = nombresUsuarios[idDestino] || 'Usuario';
				const mBox = crearGloboMensaje(msg.remitente, msg.nombre || nombreAMostrar, msg.texto, msg.hora);
				chatMessagesContainer.appendChild(mBox); 
			});
		}

		
		// 5. Autoscroll hacia el último mensaje recibido o enviado
		chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
		
		if (window.usuariosActivosRed) {
			actualizarListaUsuarios(window.usuariosActivosRed);
		}
	}
		

	// VARIABLE PARA CONTROLAR EL ESTADO LOCAL
	let estoyActivo = false;

	function activarme() {
		
		const boton = document.querySelector("#usuarios button");
		const miIdSpan = document.getElementById('mi-id');
		const nombreGuardado = nombreUsuario;
		const fotoGuardada = fotoUsuario;
		const inputTxt = document.getElementById('chatInputField');
		
		if (!estoyActivo) {
			console.log('boton','activarme activando',miId);
			// ACCIӎ: CONECTARSE
			ws.send(JSON.stringify({ 
				tipo: 'activar', 
				nombre: nombreGuardado,
				foto: fotoGuardada
			}));
			
			// CAMBIO VISUAL
			boton.innerText = "Desconectarme";
			boton.style.backgroundColor = "var(--accent-red, #ef4444)";
			miIdSpan.style.color = "var(--success, #10b981)";
			miIdSpan.style.borderColor = "var(--success, #10b981)"; 
			inputTxt.placeholder = "Debes unirte a un grupo para escribir...";
			
			estoyActivo = true;
		} else {
			console.log('boton','activarme desactivando',miId);
			desconectarme();
		}
	}

	function desconectarme() {
		console.log('boton','desconectarme',miId);
		
		const gruposProcesados = []; // Guardará los IDs que ya salieron
		gruposGlobales.forEach(grupo => {
			console.log('grupos activos',grupo.id,grupo.miembrosIds);
			if (grupo.miembrosIds.includes(miId) && !gruposProcesados.includes(grupo.id)) {
				gruposProcesados.push(grupo.id); // Lo guardamos para no repetirlo
				salirDeGrupo(grupo.id);
			}
		});
				
		const boton = document.querySelector("#usuarios button");
		const miIdSpan = document.getElementById('mi-id');
		const inputTxt = document.getElementById('chatInputField');
		const inputArchivo = document.getElementById('archivo-input');
		const btnSend = document.getElementById('sendChatBtn');

		// 1. AVISAR AL SERVIDOR
		/*
		ws.send(JSON.stringify({ 
			tipo: 'desactivar', 
			id: miId 
		}));
		*/

		// 2. RESETEAR VARIABLES INTERNAS (Crucial para evitar el chat fantasma)
		idUsuarioChateando = null;
		usuarioDestinoId = null;
		estoyActivo = false;
		if (peerConnection) {
			peerConnection.close();
			peerConnection = null;
		}

		// 3. LIMPIEZA ABSOLUTA DE LA INTERFAZ
		document.getElementById('lista-usuarios-conectados').innerHTML = '';
		document.getElementById('chatMessagesContainer').innerHTML = '<p class="subtitle">Aquí verás los mensajes de las personas en línea del grupo que selecciones.<br>También puedes crear tu propio grupo y compartir, así, tu preocupación.</p>';
		document.getElementById("chat-directo").innerHTML='Chat Directo';

		// 4. BLOQUEAR F͓ICAMENTE LAS ENTRADAS
		inputTxt.value = '';
		inputTxt.disabled = true;
		inputTxt.placeholder = "Debes estar en línea para poder escribir...";
		btnSend.disabled = true;

		// 5. RESTAURAR BOTӎ E ID ORIGINAL
		boton.innerText = "Aparecer en línea";
		boton.style.backgroundColor = "var(--primary)";
		miIdSpan.style.color = "var(--primary)";
		miIdSpan.style.borderColor = "var(--text-main)"; 
	}
		
	function abandonar() {
		// Muestra el cuadro de confirmaci󮠣on el mensaje de advertencia
		const confirmar = confirm("¿Confirmas que quieres abandonar? Se perderá todo el progreso y los datos actuales.");
		
		// Si el usuario hace clic en "Aceptar", se ejecuta la l󧩣a de salida
		if (confirmar) {
		
			// 1. AVISAR AL SERVIDOR
			ws.send(JSON.stringify({ 
				tipo: 'abandonar', 
				id: miId,
				nombre: nombreUsuario
			}));

			const boton = document.querySelector("#usuarios button");
			const miIdSpan = document.getElementById('mi-id');

			boton.innerText = "Aparecer en l󹑡";
			boton.style.backgroundColor = "var(--primary)";
			miIdSpan.style.color = "var(--primary)";
			estoyActivo = false;

			listaUsuariosConectados.innerHTML = '';
			document.getElementById('chatMessagesContainer').innerText = "Servidor desconectado";
			usuarioDestinoId = null;
			if (peerConnection) {
				peerConnection.close();
				peerConnection = null;
			}

			localStorage.removeItem('chatP2PNombre');
			localStorage.removeItem('chatP2PFoto');
			window.location.replace('index.html');
		}
	}
		
function enviarRespuestaTexto() {
    const texto = chatInputField.value.trim(); 
    
    // Validar según el chat que esté activo (Individual o Grupo)
    const esChatIndividual = !!idUsuarioChateando;
    const esChatGrupo = !!grupoSeleccionadoId;
    
    if (!texto || (!esChatIndividual && !esChatGrupo)) return;
    
    const ahora = new Date();
    const fechaHoraActual = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const container = document.getElementById('chatMessagesContainer');
    if (container) {
        // 🌟 CORRECCIÓN: Limpiamos el texto informativo si es tu primer mensaje enviado
        const mensajeBienvenida = container.querySelector('.subtitle');
        if (mensajeBienvenida || container.innerText.includes("Sala unida")) {
            container.innerHTML = ''; 
        }

        // Invocamos la función segura que nos devuelve el globo listo y lo ACUMULAMOS con appendChild
        const mBox = crearGloboMensaje('me', nombreUsuario || "Tú", texto, fechaHoraActual);
        container.appendChild(mBox); 
    }
    
    chatInputField.value = ''; // Limpia el input físicamente en pantalla
    hacerScrollAlFinal();

    if (esChatGrupo) {
        // --- FLUJO PARA GRUPOS ---
        if (!historialChats[grupoSeleccionadoId]) historialChats[grupoSeleccionadoId] = [];
        historialChats[grupoSeleccionadoId].push({ 
            remitente: 'me', 
            texto: texto, 
            nombre: nombreUsuario || "Creador", 
            hora: fechaHoraActual 
        });

        ws.send(JSON.stringify({ 
            tipo: 'enviar-mensaje-grupo', 
            grupoId: grupoSeleccionadoId, 
            desdeId: miId, 
            desdeNombre: nombreUsuario || "Creador", 
            texto: texto 
        }));

    } else if (esChatIndividual) {
        // --- FLUJO PARA CHATS PRIVADOS ---
        ultimosMovimientos[idUsuarioChateando] = Date.now();

        if (!historialChats[idUsuarioChateando]) historialChats[idUsuarioChateando] = [];
        historialChats[idUsuarioChateando].push({ remitente: 'me', texto: texto, hora: fechaHoraActual });
        
        ws.send(JSON.stringify({ 
            tipo: 'enviar-mensaje', 
            destinoId: idUsuarioChateando, 
            desdeId: miId, 
            desdeNombre: nombreUsuario || "Creador", 
            texto: texto 
        }));
    }
}
	sendChatBtn.addEventListener('click', enviarRespuestaTexto); 
	chatInputField.addEventListener('keypress', (e) => { if(e.key === 'Enter') enviarRespuestaTexto(); });

	function reproducirSonidoNotificacion() {
		try {
			const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			const oscillator = audioCtx.createOscillator();
			const gainNode = audioCtx.createGain();
			
			oscillator.type = 'sine';
			oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // Nota Re5 (Tono agradable)
			gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); // Volumen suave
			
			oscillator.connect(gainNode);
			gainNode.connect(audioCtx.destination);
			
			oscillator.start();
			oscillator.stop(audioCtx.currentTime + 0.15); // Duraci󮠣orta: 150ms
		} catch (e) {
			console.log("El navegador bloqueó audio hasta que interactúes con la página.");
		}
	}

	function mostrarMensaje(remitente, texto) {
		const historial = document.getElementById('chatMessagesContainer');
		// Adaptado para pintar las l󹑡s con los estilos oscuros
		historial.innerHTML += `<div class="msg-line"><strong>${remitente}:</strong> ${texto}</div>`;
		historial.scrollTop = historial.scrollHeight;
		console.log('mostrando mensaje',historial.innerHTML);
	}

	function enviarMensajeTexto() {
		const input = document.getElementById('mensaje-txt');
		if (!usuarioDestinoId || !input.value) return;
		ws.send(JSON.stringify({ tipo: 'enviar-mensaje', destinoId: usuarioDestinoId, desdeNombre: 'Tú', texto: input.value }));
		mostrarMensaje('Tú', input.value);
		input.value = '';
	}
	
	
	window.addEventListener('keydown', (e) => {
		if (e.code === 'F5' || (e.ctrlKey && e.code === 'KeyR')) {
			e.preventDefault(); // Frenamos el refresco inmediato
			
			// Aqu𜰰uedes usar el confirm de toda la vida
			const aceptar = confirm("¿Confirmas que quieres refrescar la página? Se perderá todo el progreso y los datos actuales.");
			
			if (aceptar) {
				// 1. AVISAR AL SERVIDOR
				ws.send(JSON.stringify({ 
					tipo: 'abandonar', 
					id: miId,
					nombre: nombreUsuario
				}));

				const boton = document.querySelector("#usuarios button");
				const miIdSpan = document.getElementById('mi-id');

				boton.innerText = "Aparecer en l󹑡";
				boton.style.backgroundColor = "var(--primary)";
				miIdSpan.style.color = "var(--primary)";
				estoyActivo = false;

				listaUsuariosConectados.innerHTML = '';
				document.getElementById('chatMessagesContainer').innerText = "Servidor desconectado";
				usuarioDestinoId = null;
				if (peerConnection) {
					peerConnection.close();
					peerConnection = null;
				}

				localStorage.removeItem('chatP2PNombre');
				localStorage.removeItem('chatP2PFoto');
				window.location.replace('index.html');
			}
		}
	});
	
function crearNuevoGrupo() {
    document.getElementById('modalInputTitulo').value = '';
    
    // Reseteamos los contadores visuales al abrir
    document.getElementById('charTitulo').innerText = '0 / 40'; 
    document.getElementById('charTitulo').style.color = '#6390b3';
    
    document.getElementById('modalCrearGrupo').style.display = 'flex';

    // NUEVO: Habilitar foco automático al abrir el modal
    setTimeout(() => {
        const inputTitulo = document.getElementById('modalInputTitulo');
        if (inputTitulo) {
            inputTitulo.focus();
        }
    }, 50);
}

function cerrarModalGrupo() {
    document.getElementById('modalCrearGrupo').style.display = 'none';
}

function procesarCrearGrupo() {
    const titulo = document.getElementById('modalInputTitulo').value.trim();
    
    if (titulo === "") {
        alert("ATENCIÓN\nPor favor, introduce al menos un título para el grupo.");
        return;
    }
    
    ws.send(JSON.stringify({
        tipo: 'crear-grupo',
        descripcion: titulo
    }));
    
    cerrarModalGrupo();
}

// Escuchadores en tiempo real para actualizar los contadores visuales y capturar el Enter
document.addEventListener("DOMContentLoaded", () => {
    const inputTitulo = document.getElementById('modalInputTitulo');
    const inputDesc = document.getElementById('modalInputDesc'); // Mantienes este por si lo usas en el HTML
    
    if(inputTitulo) {
        inputTitulo.addEventListener('input', (e) => {
            const len = e.target.value.length;
            const counter = document.getElementById('charTitulo');
            counter.innerText = `${len} / 40`;
            counter.style.color = len >= 35 ? '#dc3545' : '#6390b3'; 
        });

        // 🌟 NUEVO: Detectar la tecla Enter para procesar la creación sin usar el ratón
        inputTitulo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Evitamos que refresque la página o haga saltos de línea
                procesarCrearGrupo(); // Llama a la función que ya valida y envía los datos por WS
            }
        });
    }
});


function actualizarListaGrupos(grupos) {
	const contenedor = document.getElementById('lista-groups-conectados') || document.getElementById('lista-grupos-conectados');
	if (!contenedor) return;
	contenedor.innerHTML = '';
	
	if (grupos.length === 0) {
		contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic; padding: 10px;">No hay grupos activos</p>';
		return;
	}
	
	grupos.forEach(grupo => {
		const item = document.createElement('div');
		item.className = `usuario-item ${grupoSeleccionadoId === grupo.id ? 'seleccionado' : ''}`;
		
		// 1. CORREGIDO: Leemos de forma persistente nuestro almacén de mensajes locales sin leer
		const noLeidos = mensajesNoLeidos[grupo.id] || 0;
		grupo.mensajesNoLeidos = noLeidos; // Sincronizamos la propiedad del objeto local

		// 2. CORREGIDO: Unificamos el estilo visual con la paleta rosa llamativa (#fe3c72) usada en tus chats privados
		const badgeHTML = noLeidos > 0 
			? `<span style="background-color: #fe3c72; color: white; border-radius: 50%; padding: 2px 7px; font-size: 0.75rem; margin-right: 8px; font-weight: bold; flex-shrink: 0; display: inline-block;">${noLeidos}</span>` 
			: '';
		
		// REGLA DE EXCLUSIVIDAD: Eres miembro del grupo si es el que tienes seleccionado actualmente o estás en su lista
		// OJO const yaSoyMiembro = (grupoSeleccionadoId === grupo.id) || (grupo.miembrosIds && grupo.miembrosIds.includes(miId));
		const yaSoyMiembro = grupo.miembrosIds && grupo.miembrosIds.includes(miId);
		
		// Manejo dinámico del clic y tooltip (title) en la tarjeta
		if (yaSoyMiembro) {
			item.setAttribute('title', 'Haz clic para entrar en este grupo');
			item.style.cursor = 'pointer';
			item.onclick = () => {
				seleccionarGrupo(grupo.id, grupo.descripcion, true);
			};
		} else {
			// Si no eres miembro, recupera el title original con la descripción y quita el puntero
			item.setAttribute('title', grupo.descripcion);
			item.style.cursor = 'default';
			item.onclick = null;
		}
		
		let botonHTML = '';
		if (yaSoyMiembro) {
			// Si el usuario actual es además el dueño/autoría del grupo
			if (grupo.creadorId === miId) {
				// event.stopPropagation() evita que el clic en el botón active el onclick del div padre
				botonHTML = `<button class="btn-accion salir" title="Cerrar el grupo" onclick="event.stopPropagation(); confirmarCierreGrupo('${grupo.id}')">Cerrar</button>`;
			} else {
				// Si es un miembro normal que se unió después, ve "Salir"
				botonHTML = `<button class="btn-accion salir" title="Salir del grupo" onclick="event.stopPropagation(); salirDeGrupo('${grupo.id}')">Salir</button>`;
			}
		} else {
			botonHTML = `
				<button class="btn-accion unirse" title="Unirse al grupo" onclick="
					event.stopPropagation();
					unirseAGrupo('${grupo.id}'); 
					seleccionarGrupo('${grupo.id}', '${grupo.descripcion}', true);
				">Unirse</button>
			`;
		}

		item.innerHTML = `
			<div style="display:flex; flex-direction:column; gap:2px; overflow:hidden; flex-grow: 1; margin-right: 8px;">
				<span class="usuario-nombre" style="font-weight:bold; color:white;">${grupo.descripcion}</span>
				<span style="font-size:0.75rem; color:var(--text-muted);">${grupo.totalMiembros || (grupo.miembrosIds ? grupo.miembrosIds.length : 0)} participantes</span>
			</div>
			<div style="display:flex; align-items:center; flex-shrink: 0;">
				${badgeHTML}
				${botonHTML}
			</div>
		`;
		
		contenedor.appendChild(item);
	});
}

function seleccionarGrupo(id, descripcion, forzarActivacion = false) {
	grupoSeleccionadoId = id;
	mensajesNoLeidos[id] = 0;
	document.getElementById('chat-directo').innerText = `Grupo: ${descripcion}`;
	
	const grupoActual = gruposGlobales.find(g => g.id === id);
	const soyMiembro = forzarActivacion || (grupoActual && grupoActual.miembrosIds.includes(miId));
	
	document.getElementById('chatInputField').disabled = !soyMiembro;
	document.getElementById('sendChatBtn').disabled = !soyMiembro;
	document.getElementById('chatInputField').placeholder = soyMiembro ? "Escribe al grupo..." : "Debes unirte a un grupo para escribir...";
	
	if (soyMiembro) {
		document.getElementById('chatInputField').focus();
	}
	
	// UNIFICACIÓN DEL CONTENEDOR CENTRAL
	const container = document.getElementById('chatMessagesContainer');
	if (container) {
		container.innerHTML = '';
		
		const historial = historialChats[id] || [];
		// Busca este trozo dentro de tu función seleccionarGrupo() y adáptalo:
		if(historial.length === 0) {
			container.innerHTML = `<p class="subtitle">Sala unida. Comienza a enviar mensajes en ${descripcion}.</p>`;
		} else {
			historial.forEach(m => {
				// Si el mensaje guardado es de tipo sistema, usa su propio creador de globos
				if (m.remitente === 'sistema') {
					const mBox = crearGloboNotificacionSistema(m.texto);
					container.appendChild(mBox);
				} else {
					const mBox = crearGloboMensaje(m.remitente, m.nombre, m.texto, m.hora);
					container.appendChild(mBox);
				}
			});
		}
	}
	hacerScrollAlFinal();
	actualizarListaGrupos(gruposGlobales);
	actualizarParticipantesGrupoActual();
}

function actualizarParticipantesGrupoActual() {
	const contenedorParticipantes = document.getElementById('lista-usuarios-conectados');
	if (!contenedorParticipantes) return;
	
	if (!grupoSeleccionadoId) {
		contenedorParticipantes.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">Selecciona un grupo para ver quién está participando.</p>';
		return;
	}
	
	const grupoActual = gruposGlobales.find(g => g.id === grupoSeleccionadoId);
	if (!grupoActual) {
		contenedorParticipantes.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">El grupo ya no existe.</p>';
		return;
	}
	
	contenedorParticipantes.innerHTML = '';
	grupoActual.miembrosIds.forEach(miembroId => {
		const datosUsuario = window.usuariosActivosRed.find(u => u.id === miembroId);
		const nombre = datosUsuario ? datosUsuario.nombre : (miembroId === miId ? localStorage.getItem('chatP2PNombre') : "Usuario anónimo");
		const foto = datosUsuario ? datosUsuario.foto : '';
		const inicial = nombre.charAt(0).toUpperCase();
		
		// NUEVO: Validar si este miembro es el dueño/creador del grupo
		let etiquetaCreador = '';
		let botonBloqueoHTML = ''; // ?? NUEVO: Almacén para el botón de moderación

		if (miembroId === grupoActual.creadorId) {
			etiquetaCreador = ' <span style="background: #e11d48; color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 5px;">Mi grupo</span>';
		} else {
			// SI YO SOY EL CREADOR del grupo, pinto el botón de bloquear al lado de los DEMÁS miembros
			if (grupoActual.creadorId === miId) {
				botonBloqueoHTML = `<button onclick="ejecutarBloqueoUsuario('${grupoActual.id}', '${miembroId}', '${nombre}')" style="background: #ef4444; color: white; border: none; padding: 2px 8px; font-size: 0.75rem; border-radius: 4px; cursor: pointer; margin-left: auto; font-weight: bold;" title="Bloquear usuario de este grupo">Bloquear</button>`;
			}
		}
		
		const avatarHTML = foto 
			? `<img src="${foto}" class="avatar-lista" style="width:30px; height:30px; border-radius:50%;" alt="Avatar">` 
			: `<span class="avatar-inicial" style="width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; background:#444; border-radius:50%; font-size:0.8rem; color:white;">${inicial}</span>`;
		
		const itemUsuario = document.createElement('div');
		itemUsuario.style = 'display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); width: 100%; box-sizing: border-box;';
		
		itemUsuario.innerHTML = `
			${avatarHTML}
			<span style="color: #eee; font-size: 0.9rem; flex-grow: 1; display: flex; align-items: center;">
				${nombre} ${miembroId === miId ? '<strong>&nbsp;(Tú)&nbsp;</strong>' : ''} ${etiquetaCreador}
			</span>
			${botonBloqueoHTML}
		`;
		contenedorParticipantes.appendChild(itemUsuario);
	});
}


function unirseAGrupo(grupoId) {
	ws.send(JSON.stringify({ tipo: 'unirse-grupo', grupoId: grupoId }));
}

function salirDeGrupo(grupoId) {
    if(grupoSeleccionadoId === grupoId) {
        grupoSeleccionadoId = null;
        document.getElementById('chatInputField').disabled = true;
        document.getElementById('sendChatBtn').disabled = true;
        document.getElementById('chatInputField').placeholder = "Debes unirte a un grupo para escribir...";
        document.getElementById('chat-directo').innerText = "Sala de Chat";
        document.getElementById('chatMessagesContainer').innerHTML = '<p class="subtitle">Aquí verás los mensajes del grupo que selecciones.</p>';
    }
    
    // Forzamos el borrado manual en nuestro registro local de grupos para no vernos dentro mientras el servidor responde
    const grupoActual = gruposGlobales.find(g => g.id === grupoId);
    if (grupoActual && grupoActual.miembrosIds) {
        grupoActual.miembrosIds = grupoActual.miembrosIds.filter(id => id !== miId);
    }

    // OJO ws.send(JSON.stringify({ tipo: 'salir-grupo', grupoId: grupoId }));
	participanteSalirGrupo(grupoId);
}

function confirmarCierreGrupo(grupoId) {
    const confirmar = confirm("ATENCIÓN:\nEres la autoría de este grupo. Si lo cierras, se eliminará por completo para todos los participantes y se perderá el historial de mensajes.\n\n¿Confirmas que quieres cerrar el grupo?");
    
    if (confirmar) {
		/* OJO 
        // 1. Enviamos la orden de salida al servidor (quien ejecutará la destrucción total)
        if (typeof salirDeGrupo === 'function') {
            salirDeGrupo(grupoId);
        }
		*/
		
		creadorCerrarGrupo(grupoId);

        // 2. Si el grupo que cierras es el que tienes abierto en pantalla, reseteamos la interfaz
        if (grupoSeleccionadoId === grupoId) {
            grupoSeleccionadoId = null; 
            
            // Limpiamos el contenedor correcto de mensajes
            const container = document.getElementById('chatMessagesContainer');
            if (container) {
                container.innerHTML = '<p class="subtitle" style="color: #6390b3; font-style: italic;">Has cerrado tu grupo activo.</p>';
            }

            // Restauramos el título de la cabecera central
            const tituloGrupoHeader = document.getElementById('chat-directo'); 
            if (tituloGrupoHeader) {
                tituloGrupoHeader.innerText = 'Selecciona un grupo para comenzar';
            }
            
            // Deshabilitamos físicamente las entradas de texto
            const inputChat = document.getElementById('chatInputField');
            const botonEnviar = document.getElementById('sendChatBtn');
            if (inputChat) {
                inputChat.value = '';
                inputChat.disabled = true;
                inputChat.placeholder = 'Selecciona un grupo para escribir...';
            }
            if (botonEnviar) {
                botonEnviar.disabled = true;
            }
            
            // Limpiamos la barra lateral de participantes
            const contenedorParticipantes = document.getElementById('lista-usuarios-conectados');
            if (contenedorParticipantes) {
                contenedorParticipantes.innerHTML = '<p style="color: var(--text-muted); font-size: 0.85rem; font-style: italic;">Selecciona un grupo para ver quién está participando.</p>';
            }
        }

        // 3. Limpiamos los mensajes no leídos locales de este grupo
        if (mensajesNoLeidos && mensajesNoLeidos[grupoId]) {
            delete mensajesNoLeidos[grupoId];
        }
    }
}
	
	
function crearGloboNotificacionSistema(texto) {
    const lineBox = document.createElement('div');
    // Estilos para centrar el texto informativo y darle estética de sistema
    lineBox.style.display = 'flex';
    lineBox.style.justifyContent = 'center';
    lineBox.style.width = '100%';
    lineBox.style.margin = '10px 0';
    
    const innerSpan = document.createElement('span');
    innerSpan.style.background = 'rgba(255, 255, 255, 0.06)';
    innerSpan.style.color = 'var(--text-muted, #a0aec0)';
    innerSpan.style.fontSize = '0.8rem';
    innerSpan.style.padding = '4px 12px';
    innerSpan.style.borderRadius = '20px';
    innerSpan.style.fontStyle = 'italic';
    innerSpan.style.border = '1px solid rgba(255, 255, 255, 0.03)';
    innerSpan.textContent = texto;
    
    lineBox.appendChild(innerSpan);
    return lineBox;
}

// === ACCIÓN PARA EL PARTICIPANTE ===
function participanteSalirGrupo(grupoId) {
    if (!grupoId) return console.error("ID de grupo no válido");
    
    // Enviamos la petición limpia al servidor
    ws.send(JSON.stringify({ 
        tipo: 'salir-grupo', 
        grupoId: grupoId 
    }));
}

// === ACCIÓN PARA EL CREADOR ===
function creadorCerrarGrupo(grupoId) {
    if (!grupoId) return console.error("ID de grupo no válido");
    
    // Confirmación opcional por seguridad antes de destruir
	ws.send(JSON.stringify({ 
		tipo: 'cerrar-grupo', 
        grupoId: grupoId 
	}));
}

// === ACCIÓN EMISORA PARA EL BLOQUEO ===
function ejecutarBloqueoUsuario(grupoId, infractorId, nombreInfractor) {
    if (!grupoId || !infractorId) return console.error("Datos de moderación incompletos.");
    
    // Confirmación nativa de seguridad para evitar clics accidentales
    const confirmar = confirm(`¿Realmente deseas expulsar y bloquear de forma permanente a "${nombreInfractor}" de este grupo?`);
    
    if (confirmar) {
        ws.send(JSON.stringify({
            tipo: 'bloquear-usuario',
            grupoId: grupoId,
            infractorId: infractorId
        }));
    }
}


	
// --- LÓGICA DEL BUSCADOR DE GRUPOS ACTIVOS ---
const btnAbrirBusqueda = document.getElementById('btnAbrirBusqueda');
const btnCerrarBusqueda = document.getElementById('btnCerrarBusqueda');
const modalBusqueda = document.getElementById('modalBusqueda');
const inputBusquedaGrupo = document.getElementById('inputBusquedaGrupo');
const resultadosBusqueda = document.getElementById('resultadosBusqueda');

// --- LÓGICA DEL BUSCADOR DE GRUPOS ACTIVOS ---
function abrirBuscadorGrupos() {
  const modal = document.getElementById('modalBusqueda');
  const input = document.getElementById('inputBusquedaGrupo');
  
  if (modal && input) {
    modal.style.display = 'flex';
    input.value = '';
    input.focus();
    filtrarGruposActivos('');
  }
}

function cerrarBuscadorGrupos() {
  const modal = document.getElementById('modalBusqueda');
  if (modal) {
    modal.style.display = 'none';
  }
}

// Filtrar mientras el usuario escribe
document.addEventListener('input', function(e) {
  if (e.target && e.target.id === 'inputBusquedaGrupo') {
    filtrarGruposActivos(e.target.value.toLowerCase().trim());
  }
});

// Cerrar el popup al hacer clic fuera de la caja oscura
window.addEventListener('click', function(e) {
  const modal = document.getElementById('modalBusqueda');
  if (e.target === modal) {
    cerrarBuscadorGrupos();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarBuscadorGrupos();
});

// Asegurar que el filtro se ejecute al escribir o pegar texto
const campoBusqueda = document.getElementById('inputBusquedaGrupo');
if (campoBusqueda) {
  campoBusqueda.oninput = function() {
    filtrarGruposActivos(this.value.toLowerCase().trim());
  };
}

function filtrarGruposActivos(textoBusqueda) {
  const resultadosBusqueda = document.getElementById('resultadosBusqueda');
  if (!resultadosBusqueda) return;

  resultadosBusqueda.innerHTML = '';
  const tarjetasGrupos = document.querySelectorAll('#lista-grupos-conectados > div');

  tarjetasGrupos.forEach(tarjeta => {
    // 1. Extraemos SOLO la primera línea de texto (el título del grupo)
    // Así ignoramos "1 participantes", "Cerrar", "Unirse", etc.
    const lineasTexto = tarjeta.innerText.split('\n').map(l => l.trim()).filter(Boolean);
    const tituloGrupo = lineasTexto.length > 0 ? lineasTexto[0].toLowerCase() : '';
	const quitarTildes = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 2. Comprobamos si el título contiene lo que el usuario escribió
    if (quitarTildes(tituloGrupo).includes(quitarTildes(textoBusqueda))) {
      const clonTarjeta = tarjeta.cloneNode(true);
      const botonOriginal = tarjeta.querySelector('button');
      const botonClonado = clonTarjeta.querySelector('button');

      if (botonOriginal && botonClonado) {
        botonClonado.removeAttribute('onclick');
        botonClonado.addEventListener('click', (e) => {
          e.stopPropagation();
          botonOriginal.click();
          cerrarBuscadorGrupos();
        });
      }

      resultadosBusqueda.appendChild(clonTarjeta);
    }
  });

  if (resultadosBusqueda.children.length === 0) {
    resultadosBusqueda.innerHTML = '<p style="color: #a0aec0; text-align: center; font-size: 0.9rem; margin: 15px 0;">No se encontraron grupos que coincidan.</p>';
  }
}

// Archivos de voz
// =========================================================
// --- GESTIÓN DE NOTAS DE VOZ (SIN CARGA EN SERVIDOR) ---
// =========================================================
let mediaRecorder = null;
let fragmentosAudio = [];
let estaGrabandoAudio = false;
let intervaloTiempoAudio = null;
let segundosGrabados = 0;
const MAX_SEGUNDOS_AUDIO = 30; // Límite de 30s para mantener consumo mínimo en Render

const iconoMicroSVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
    <line x1="12" y1="19" x2="12" y2="23"></line>
    <line x1="8" y1="23" x2="16" y2="23"></line>
  </svg>`;

const iconoStopSVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2"></rect>
  </svg>`;

// Sincroniza automáticamente el estado disabled del micrófono con el de chatInputField
const campoTextoRef = document.getElementById('chatInputField');
const btnMicroRef = document.getElementById('recordAudioBtn');

if (campoTextoRef && btnMicroRef) {
  const observerMicro = new MutationObserver(() => {
    btnMicroRef.disabled = campoTextoRef.disabled;
    if (campoTextoRef.disabled && estaGrabandoAudio) {
      detenerYEnviarAudio(false); // Cancela si te expulsan o sales del grupo grabando
    }
  });
  observerMicro.observe(campoTextoRef, { attributes: true, attributeFilter: ['disabled'] });

  btnMicroRef.addEventListener('click', () => {
    if (!estaGrabandoAudio) {
      iniciarGrabacionVoz();
    } else {
      detenerYEnviarAudio(true);
    }
  });
}

async function iniciarGrabacionVoz() {
  if (!grupoSeleccionadoId && !idUsuarioChateando) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Usamos bitrate bajo (24kbps) ideal para voz: 30s pesan menos de 90 KB
    const opciones = { audioBitsPerSecond: 24000 };
    mediaRecorder = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', ...opciones })
      : new MediaRecorder(stream, opciones);

    fragmentosAudio = [];
    estaGrabandoAudio = true;
    segundosGrabados = 0;

    // Actualizar aspecto del botón a grabando
    btnMicroRef.classList.add('grabando');
    btnMicroRef.innerHTML = `${iconoStopSVG} <span style="font-size:0.8rem; font-weight:bold;">0:00</span>`;

    intervaloTiempoAudio = setInterval(() => {
      segundosGrabados++;
      const segFormateados = segundosGrabados < 10 ? `0${segundosGrabados}` : segundosGrabados;
      btnMicroRef.innerHTML = `${iconoStopSVG} <span style="font-size:0.8rem; font-weight:bold;">0:${segFormateados}</span>`;

      if (segundosGrabados >= MAX_SEGUNDOS_AUDIO) {
        detenerYEnviarAudio(true); // Envío automático al llegar a 30s
      }
    }, 1000);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) fragmentosAudio.push(e.data);
    };

    mediaRecorder.onstop = () => {
      // Apagamos siempre el micrófono del navegador al terminar
      stream.getTracks().forEach(track => track.stop());

      if (!mediaRecorder.enviarAlParar || fragmentosAudio.length === 0) return;

      const audioBlob = new Blob(fragmentosAudio, { type: mediaRecorder.mimeType || 'audio/webm' });
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      reader.onloadend = () => {
        enviarNotaDeVozPorWS(`AUDIO_VOICE::${reader.result}`);
      };
    };

    mediaRecorder.start();
  } catch (err) {
    console.error("Error al acceder al micrófono:", err);
    alert("No se pudo acceder al micrófono. Asegúrate de dar permisos en tu navegador y usar HTTPS o localhost.");
    resetearBotonMicro();
  }
}

function detenerYEnviarAudio(enviar = true) {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.enviarAlParar = enviar;
    mediaRecorder.stop();
  }
  resetearBotonMicro();
}

function resetearBotonMicro() {
  estaGrabandoAudio = false;
  clearInterval(intervaloTiempoAudio);
  if (btnMicroRef) {
    btnMicroRef.classList.remove('grabando');
    btnMicroRef.innerHTML = iconoMicroSVG;
  }
}

function enviarNotaDeVozPorWS(payloadAudio) {
  const esChatIndividual = !!idUsuarioChateando;
  const esChatGrupo = !!grupoSeleccionadoId;
  if (!esChatIndividual && !esChatGrupo) return;

  const ahora = new Date();
  const fechaHoraActual = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const container = document.getElementById('chatMessagesContainer');
  if (container) {
    const mensajeBienvenida = container.querySelector('.subtitle');
    if (mensajeBienvenida || container.innerText.includes("Sala unida")) {
      container.innerHTML = '';
    }
    const mBox = crearGloboMensaje('me', nombreUsuario || "Tú", payloadAudio, fechaHoraActual);
    container.appendChild(mBox);
  }
  hacerScrollAlFinal();

  if (esChatGrupo) {
    if (!historialChats[grupoSeleccionadoId]) historialChats[grupoSeleccionadoId] = [];
    historialChats[grupoSeleccionadoId].push({
      remitente: 'me',
      texto: payloadAudio,
      nombre: nombreUsuario || "Creador",
      hora: fechaHoraActual
    });

    ws.send(JSON.stringify({
      tipo: 'enviar-mensaje-grupo',
      grupoId: grupoSeleccionadoId,
      desdeId: miId,
      desdeNombre: nombreUsuario || "Creador",
      texto: payloadAudio
    }));
  } else if (esChatIndividual) {
    ultimosMovimientos[idUsuarioChateando] = Date.now();
    if (!historialChats[idUsuarioChateando]) historialChats[idUsuarioChateando] = [];
    historialChats[idUsuarioChateando].push({
      remitente: 'me',
      texto: payloadAudio,
      hora: fechaHoraActual
    });

    ws.send(JSON.stringify({
      tipo: 'enviar-mensaje',
      destinoId: idUsuarioChateando,
      desdeId: miId,
      desdeNombre: nombreUsuario || "Creador",
      texto: payloadAudio
    }));
  }
}
