const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;

// 1. Creamos un servidor HTTP para servir tus archivos .html, .css y .js
const server = http.createServer((req, res) => {
    let filePath = path.join(__dirname, 'public', req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    
    const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'text/javascript',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml'
    };

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            res.end(err.code === 'ENOENT' ? 'Archivo no encontrado' : 'Error interno');
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
            res.end(content, 'utf-8');
        }
    });
});

// 2. Conectamos el WebSocketServer al mismo servidor HTTP
const wss = new WebSocketServer({ server });

// 3. Arrancamos ambos en el puerto asignado
server.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});


// Conjunto para almacenar los nombres de usuario activos
const usuariosConectados = new Set();
let usuariosActivos = [];
let chatsActivos = new Set();

// NUEVO: Estructura para almacenar los grupos creados
// Cada grupo será un objeto: { id: '...', creadorId: '...', descripcion: '...', miembros: Set }
let gruposActivos = [];

wss.on('connection', (ws) => {
    
    ws.on('message', (message) => {
        const datos = JSON.parse(message);
        console.log('accion', datos, ws.userId);
        
        // Evitamos reiniciar estos valores si el usuario ya envió 'conectar' o 'activar'
        if (ws.nombreUsuario === undefined) ws.nombreUsuario = null; 
        if (ws.cambiandoDePagina === undefined) ws.cambiandoDePagina = false; 			
		
		// === VALIDACIÓN DE NOMBRE DUPLICADO ===
		if (datos.tipo === 'validar-nombre') {
            const nombreBuscar = datos.nombre.trim().toLowerCase();

            if (usuariosConectados.has(nombreBuscar)) {
                ws.send(JSON.stringify({ tipo: 'resultado-validacion', valido: false }));
            } else {
                usuariosConectados.add(nombreBuscar);
				ws.cambiandoDePagina = true;                 
                ws.send(JSON.stringify({ tipo: 'resultado-validacion', valido: true }));
            }
        }
		
		if (datos.tipo === 'conectar') {
			ws.userId = Math.random().toString(36).substring(7);
            ws.nombreUsuario = datos.nombre.trim().toLowerCase(); 
			ws.send(JSON.stringify({ tipo: 'tu-id', id: ws.userId }));
		}
		
        if (datos.tipo === 'activar') {
            usuariosActivos = usuariosActivos.filter(u => u.id !== ws.userId);
            usuariosActivos.push({
                id: ws.userId, nombre: datos.nombre, foto: datos.foto, ws: ws
            });
            // ?? NUEVO: Guardamos el nombre real directamente en la conexión del cliente
            ws.nombreReal = datos.nombre; 
            broadcastUsuarios();
        }

        // === CREAR UN GRUPO ===
        if (datos.tipo === 'crear-grupo') {
            const nuevoGrupo = {
                id: Math.random().toString(36).substring(7), // ID único del grupo
                creadorId: ws.userId,
                descripcion: datos.descripcion, // El texto informativo del grupo
                miembros: new Set([ws.userId]), // El creador entra automáticamente
                bloqueados: new Set()			
            };
            gruposActivos.push(nuevoGrupo);
            
            // ?? NUEVO: Avisamos específicamente al creador para que su interfaz se auto-seleccione
            ws.send(JSON.stringify({
                tipo: 'grupo-creado-exito',
                grupoId: nuevoGrupo.id,
                descripcion: nuevoGrupo.descripcion
            }));

            broadcastUsuarios(); // Enviamos la lista de usuarios y grupos actualizada a todos
        }


		// === EN TU SERVER.JS ===
        if (datos.tipo === 'unirse-grupo') {
            const grupo = gruposActivos.find(g => g.id === datos.grupoId);
            if (grupo) {
                // NUEVO: Comprobación de bloqueo
                if (grupo.bloqueados && grupo.bloqueados.has(ws.userId)) {
                    ws.send(JSON.stringify({
                        tipo: 'error-unirse-grupo',
                        mensaje: 'Has sido expulsado o expulsada de este grupo'
                    }));
                    return; // Detenemos la ejecución para que no entre
                }

                const miembrosAntes = Array.from(grupo.miembros);
                grupo.miembros.add(ws.userId);
                broadcastUsuarios();

                if (miembrosAntes.length > 0) {
                    const usuarioSincronizadorId = miembrosAntes[0];
                    wss.clients.forEach(client => {
                        if (client.userId === usuarioSincronizadorId) {
                            client.send(JSON.stringify({
                                tipo: 'solicitar-historial-grupo',
                                grupoId: grupo.id,
                                solicitanteId: ws.userId
                            }));
                        }
                    });
                }
            }
        }

		// === SALIR DE UN GRUPO (PARTICIPANTE O CREADOR TEMPORALMENTE) ===
		if (datos.tipo === 'salir-grupo') {
			const grupo = gruposActivos.find(g => g.id === datos.grupoId);
			if (grupo) {
				const nombreQueSale = ws.nombreReal || "Un usuario";

				// 1. Notificamos al resto de miembros de este grupo específico
				wss.clients.forEach(client => {
					if (client.userId !== ws.userId && grupo.miembros.has(client.userId)) {
						client.send(JSON.stringify({
							tipo: 'recibir-notificacion-sistema',
							grupoId: grupo.id,
							texto: `${nombreQueSale} se ha salido del grupo`
						}));
					}
				});

				// 2. Lo eliminamos únicamente de los miembros activos, manteniendo el grupo vivo
				grupo.miembros.delete(ws.userId);

				// 3. Sincronizamos los cambios para todos los usuarios del servidor
				broadcastUsuarios();
			}
		}

		// === CREADOR: CERRAR / DESTRUIR UN GRUPO ===
		if (datos.tipo === 'cerrar-grupo') {
			const grupo = gruposActivos.find(g => g.id === datos.grupoId);

			if (grupo) {
				// Validación de seguridad: Solo el creador real puede ejecutar la destrucción
				if (grupo.creadorId === ws.userId) {
					
					// 1. Notificar a todos los miembros de este grupo que la sala va a ser destruida
					wss.clients.forEach(client => {
						if (grupo.miembros.has(client.userId)) {
							client.send(JSON.stringify({
								tipo: 'grupo-destruido-por-creador',
								grupoId: grupo.id
							}));
						}
					});

					// 2. Limpieza de memoria: Vaciamos el Set y filtramos el array global sacando este ID
					grupo.miembros.clear();
					gruposActivos = gruposActivos.filter(g => g.id !== datos.grupoId);

					broadcastUsuarios();
				}
			}
		}
		
        // === CREADOR: EXPULSAR Y BLOQUEAR A UN USUARIO ===
        if (datos.tipo === 'bloquear-usuario') {
            const grupo = gruposActivos.find(g => g.id === datos.grupoId);

            // Verificamos que el grupo exista y que quien envía la orden sea el creador real
            if (grupo && grupo.creadorId === ws.userId && datos.infractorId !== ws.userId) {
                
                // 1. Añadimos el ID del infractor a la lista de bloqueados del grupo
                if (!grupo.bloqueados) grupo.bloqueados = new Set();
                grupo.bloqueados.add(datos.infractorId);

                // 2. Lo eliminamos de los miembros activos del grupo
                grupo.miembros.delete(datos.infractorId);

                // 3. Buscamos el nombre del infractor para la notificación
                const infractorObj = usuariosActivos.find(u => u.id === datos.infractorId);
                const nombreInfractor = infractorObj ? infractorObj.nombre : "Un usuario";

                // 4. Notificamos al infractor que ha sido expulsado y a los demás miembros del grupo
                wss.clients.forEach(client => {
                    if (client.userId === datos.infractorId) {
                        client.send(JSON.stringify({
                            tipo: 'expulsado-del-grupo',
                            grupoId: grupo.id,
                            descripcion: grupo.descripcion
                        }));
                    } else if (grupo.miembros.has(client.userId)) {
                        client.send(JSON.stringify({
                            tipo: 'recibir-notificacion-sistema',
                            grupoId: grupo.id,
                            texto: `${nombreInfractor} ha sido expulsado y bloqueado del grupo`
                        }));
                    }
                });

                // 5. Actualizamos las listas de miembros para todos
                broadcastUsuarios();
            }
        }
		

        if (datos.tipo === 'desactivar') {
            usuariosActivos = usuariosActivos.filter(u => u.id !== ws.userId);
            eliminarChatsDeUsuario(ws.userId);
            eliminarUsuarioDeGrupos(ws.userId); // NUEVO
            broadcastUsuarios();
            
            wss.clients.forEach(client => {
                client.send(JSON.stringify({ 
                    tipo: 'usuario-desconectado', id: ws.userId 
                }));
            });
        }

        if (datos.tipo === 'abandonar') {
            usuariosActivos = usuariosActivos.filter(u => u.id !== ws.userId);
            eliminarChatsDeUsuario(ws.userId);
            
            // CLAVE: Como el usuario abandona la app del todo, destruimos sus grupos creados para que no queden huérfanos
            destruirGruposPorCreador(ws.userId); 
            
            const nombreEliminar = datos.nombre.trim().toLowerCase();
			usuariosConectados.delete(nombreEliminar); 
            
            wss.clients.forEach(client => {
                client.send(JSON.stringify({ 
                    tipo: 'usuario-desconectado', id: ws.userId 
                }));
            });
        }
		
        if (datos.tipo === 'enviar-mensaje') {
            const chatKey = [ws.userId, datos.destinoId].sort().join('-');
            chatsActivos.add(chatKey);
            broadcastUsuarios();
			
            wss.clients.forEach(client => {
                if (client.userId === datos.destinoId) {
                    client.send(JSON.stringify({ 
                        tipo: 'recibir-mensaje', 
                        desdeNombre: datos.desdeNombre, 
                        desdeId: ws.userId, texto: datos.texto 
                    }));
                }
            });
        }

        // === NUEVO: ENVIAR MENSAJE A UN GRUPO ===
        if (datos.tipo === 'enviar-mensaje-grupo') {
            const grupo = gruposActivos.find(g => g.id === datos.grupoId);
            if (grupo && grupo.miembros.has(ws.userId)) {
                // Reenviar el mensaje a todos los usuarios activos que estén en el grupo
                wss.clients.forEach(client => {
                    if (grupo.miembros.has(client.userId)) {
                        client.send(JSON.stringify({
                            tipo: 'recibir-mensaje-grupo',
                            grupoId: grupo.id,
                            desdeNombre: datos.desdeNombre,
                            desdeId: ws.userId,
                            texto: datos.texto
                        }));
                    }
                });
            }
        }
		
		// NUEVO EVENTO EN SERVER.JS: Hace de puente para pasar los mensajes entre navegadores
		if (datos.tipo === 'transferir-historial-grupo') {
			wss.clients.forEach(client => {
				if (client.userId === datos.solicitanteId) {
					client.send(JSON.stringify({
						tipo: 'recibir-historial-p2p',
						grupoId: datos.grupoId,
						mensajes: datos.mensajes
					}));
				}
			});
		}
		
		
		if (datos.tipo === 'contador-usuarios-conectados') {
			ws.send(JSON.stringify({ tipo: 'contador-usuarios-conectados', total: usuariosActivos.length }));
		}
    });

	ws.on('close', () => {
		console.log('server', 'close');
		if (ws.cambiandoDePagina) {
			return;
		}

		usuariosActivos = usuariosActivos.filter(u => u.ws !== ws);
		eliminarChatsDeUsuario(ws.userId);
		eliminarUsuarioDeGrupos(ws.userId);

		// === NUEVO: DESTRUIR GRUPOS SI EL QUE SE CIERRA ES EL CREADOR ===
		// 1. Buscamos las salas que pertenecen al usuario que se acaba de desconectar
		const gruposADestruir = gruposActivos.filter(g => g.creadorId === ws.userId);

		gruposADestruir.forEach(grupo => {
			// 2. Avisamos a los participantes online de este grupo que la sala se cierra
			wss.clients.forEach(client => {
				if (grupo.miembros.has(client.userId)) {
					client.send(JSON.stringify({
						tipo: 'grupo-destruido-por-creador',
						grupoId: grupo.id
					}));
				}
			});
			grupo.miembros.clear(); // Vaciamos sus miembros en memoria
		});

		// 3. Eliminamos definitivamente esas salas del array global
		gruposActivos = gruposActivos.filter(g => g.creadorId !== ws.userId);
		// ===============================================================

		broadcastUsuarios();
		
		wss.clients.forEach(client => {
			client.send(JSON.stringify({ 
				tipo: 'usuario-connected', // O 'usuario-desconectado' según tu flujo
				id: ws.userId 
			}));
		});
	});
});

function eliminarChatsDeUsuario(userId) {
    chatsActivos.forEach(chatKey => {
        if (chatKey.includes(userId)) {
            chatsActivos.delete(chatKey);
        }
    });
}

function eliminarUsuarioDeGrupos(userId) {
    gruposActivos.forEach(grupo => {
        // Si el usuario pertenece a este grupo y NO es el creador, lo quitamos pacíficamente
        if (grupo.miembros.has(userId) && grupo.creadorId !== userId) {
            grupo.miembros.delete(userId);
            
            // Avisamos al resto de participantes que sigan online en este grupo
            const nombreQueSale = "Un participante";
            wss.clients.forEach(client => {
                if (client.userId !== userId && grupo.miembros.has(client.userId)) {
                    client.send(JSON.stringify({
                        tipo: 'recibir-notificacion-sistema',
                        grupoId: grupo.id,
                        texto: `${nombreQueSale} se ha desconectado`
                    }));
                }
            });
        }
    });
}


// Envía la lista pública junto a los contadores y GRUPOS en tiempo real
function broadcastUsuarios() {
    const listaPublica = usuariosActivos.map(u => ({ 
        id: u.id, 
        nombre: u.nombre,
        foto: u.foto
    }));

    // NUEVO: Mapeamos los grupos convirtiendo el 'Set' de miembros a un Array para poder enviarlo por JSON
    const listaGruposPublica = gruposActivos.map(g => ({
        id: g.id,
        creadorId: g.creadorId,
        descripcion: g.descripcion,
        totalMiembros: g.miembros.size,
        miembrosIds: Array.from(g.miembros)
    }));

    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({ 
                tipo: 'lista-usuarios', 
                usuarios: listaPublica,
                grupos: listaGruposPublica, // Envia los grupos disponibles
                totalPerfiles: usuariosActivos.length,
                totalChats: chatsActivos.size + gruposActivos.length // Sumamos salas al contador visual
            }));
        }
    });
}

function destruirGruposPorCreador(userId, grupoId) {
    gruposActivos.forEach(grupo => {
        // Validamos estrictamente que sea el creador Y el grupo específico a cerrar
        if (grupo.creadorId === userId && grupo.id === grupoId) {
            wss.clients.forEach(client => {
                if (grupo.miembros.has(client.userId)) {
                    client.send(JSON.stringify({
                        tipo: 'grupo-destruido-por-creador',
                        grupoId: grupo.id
                    }));
                }
            });
            grupo.miembros.clear(); 
        }
    });

    // Ahora el filtro solo eliminará de la memoria global el grupo que coincide con el ID cerrado
    gruposActivos = gruposActivos.filter(g => g.id !== grupoId);
}