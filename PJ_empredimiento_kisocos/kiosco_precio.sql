-- ============================================================
--  KioscoPrecio — Schema MySQL
--  Importar en MySQL Workbench: File > Open SQL Script
--  Luego ejecutar con Ctrl+Shift+Enter
-- ============================================================

CREATE DATABASE IF NOT EXISTS kiosco_precio
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE kiosco_precio;

-- ------------------------------------------------------------
-- TABLA: proveedores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proveedores (
  id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(120)    NOT NULL,
  telefono      VARCHAR(30)         NULL,
  email         VARCHAR(120)        NULL,
  direccion     VARCHAR(200)        NULL,
  activo        TINYINT(1)      NOT NULL DEFAULT 1,
  creado_en     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_proveedores_nombre (nombre)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- TABLA: categorias
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
  id            INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  nombre        VARCHAR(80)     NOT NULL,
  descripcion   VARCHAR(200)        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categorias_nombre (nombre)
) ENGINE=InnoDB;

-- Categorías por defecto para kiosco
INSERT IGNORE INTO categorias (nombre) VALUES
  ('Bebidas gaseosas'),
  ('Aguas y jugos'),
  ('Lácteos'),
  ('Snacks y golosinas'),
  ('Cigarrillos'),
  ('Panadería'),
  ('Limpieza'),
  ('Higiene personal'),
  ('Otros');

-- ------------------------------------------------------------
-- TABLA: productos
-- Almacena el precio ACTUAL de cada producto
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS productos (
  id              INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  nombre          VARCHAR(150)    NOT NULL,
  codigo          VARCHAR(60)         NULL  COMMENT 'Código de barras o interno',
  categoria_id    INT UNSIGNED        NULL,
  precio_actual   DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
  proveedor_id    INT UNSIGNED        NULL,
  ultima_fecha    DATE                NULL  COMMENT 'Fecha de la última lista analizada',
  activo          TINYINT(1)      NOT NULL DEFAULT 1,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_productos_nombre (nombre),
  KEY idx_productos_categoria (categoria_id),
  KEY idx_productos_proveedor (proveedor_id),
  CONSTRAINT fk_productos_categoria
    FOREIGN KEY (categoria_id) REFERENCES categorias(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_productos_proveedor
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- TABLA: historial_precios
-- Cada vez que un precio cambia, se inserta una fila aquí
-- La app SOLO inserta cuando el precio es distinto al anterior
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_precios (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  producto_id     INT UNSIGNED    NOT NULL,
  proveedor_id    INT UNSIGNED        NULL,
  precio          DECIMAL(10,2)   NOT NULL,
  precio_anterior DECIMAL(10,2)       NULL  COMMENT 'NULL si es el primer registro',
  porcentaje_cambio DECIMAL(6,2)      NULL  COMMENT 'Positivo = sube, negativo = baja',
  fecha_lista     DATE            NOT NULL  COMMENT 'Fecha de la lista del proveedor',
  registrado_en   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_hist_producto   (producto_id),
  KEY idx_hist_proveedor  (proveedor_id),
  KEY idx_hist_fecha      (fecha_lista),
  CONSTRAINT fk_hist_producto
    FOREIGN KEY (producto_id)  REFERENCES productos(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_hist_proveedor
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- TABLA: analisis
-- Cada foto analizada genera un registro aquí
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analisis (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  proveedor_id    INT UNSIGNED        NULL,
  proveedor_libre VARCHAR(120)        NULL  COMMENT 'Nombre si no existe en la tabla proveedores',
  fecha_lista     DATE            NOT NULL,
  total_productos SMALLINT        NOT NULL DEFAULT 0,
  productos_suben SMALLINT        NOT NULL DEFAULT 0,
  productos_bajan SMALLINT        NOT NULL DEFAULT 0,
  sin_cambio      SMALLINT        NOT NULL DEFAULT 0,
  nuevos          SMALLINT        NOT NULL DEFAULT 0,
  creado_en       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_analisis_proveedor (proveedor_id),
  KEY idx_analisis_fecha     (fecha_lista),
  CONSTRAINT fk_analisis_proveedor
    FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- TABLA: analisis_detalle
-- Cada producto detectado en un análisis
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analisis_detalle (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  analisis_id         BIGINT UNSIGNED NOT NULL,
  producto_id         INT UNSIGNED        NULL  COMMENT 'NULL si es un nombre libre no mapeado',
  nombre_detectado    VARCHAR(150)    NOT NULL  COMMENT 'Nombre tal como lo devolvió Claude',
  precio_proveedor    DECIMAL(10,2)   NOT NULL,
  precio_anterior     DECIMAL(10,2)       NULL,
  cambio              ENUM('subio','bajo','igual','nuevo') NOT NULL DEFAULT 'nuevo',
  porcentaje_cambio   DECIMAL(6,2)        NULL,
  recomendacion       ENUM('conviene','neutro','no conviene') NOT NULL DEFAULT 'neutro',
  razon               VARCHAR(200)        NULL,
  PRIMARY KEY (id),
  KEY idx_det_analisis (analisis_id),
  KEY idx_det_producto (producto_id),
  CONSTRAINT fk_det_analisis
    FOREIGN KEY (analisis_id) REFERENCES analisis(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_det_producto
    FOREIGN KEY (producto_id) REFERENCES productos(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- VISTAS ÚTILES
-- ============================================================

-- Vista: precio actual de cada producto con su proveedor
CREATE OR REPLACE VIEW v_precios_actuales AS
SELECT
  p.id,
  p.nombre                          AS producto,
  p.precio_actual                   AS precio_actual,
  c.nombre                          AS categoria,
  pr.nombre                         AS proveedor,
  p.ultima_fecha,
  (
    SELECT hp2.precio
    FROM historial_precios hp2
    WHERE hp2.producto_id = p.id
    ORDER BY hp2.fecha_lista DESC, hp2.id DESC
    LIMIT 1 OFFSET 1
  )                                  AS precio_anterior,
  ROUND(
    (p.precio_actual - (
      SELECT hp3.precio
      FROM historial_precios hp3
      WHERE hp3.producto_id = p.id
      ORDER BY hp3.fecha_lista DESC, hp3.id DESC
      LIMIT 1 OFFSET 1
    )) /
    NULLIF((
      SELECT hp3.precio
      FROM historial_precios hp3
      WHERE hp3.producto_id = p.id
      ORDER BY hp3.fecha_lista DESC, hp3.id DESC
      LIMIT 1 OFFSET 1
    ), 0) * 100, 2
  )                                  AS variacion_pct
FROM productos p
LEFT JOIN categorias  c  ON c.id  = p.categoria_id
LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
WHERE p.activo = 1;

-- Vista: historial completo con nombre de producto y proveedor
CREATE OR REPLACE VIEW v_historial_completo AS
SELECT
  hp.id,
  p.nombre                          AS producto,
  pr.nombre                         AS proveedor,
  hp.precio,
  hp.precio_anterior,
  hp.porcentaje_cambio,
  hp.fecha_lista,
  hp.registrado_en
FROM historial_precios hp
JOIN  productos   p  ON p.id  = hp.producto_id
LEFT JOIN proveedores pr ON pr.id = hp.proveedor_id
ORDER BY hp.fecha_lista DESC, hp.id DESC;

-- Vista: resumen de los últimos 10 análisis
CREATE OR REPLACE VIEW v_ultimos_analisis AS
SELECT
  a.id,
  COALESCE(pr.nombre, a.proveedor_libre) AS proveedor,
  a.fecha_lista,
  a.total_productos,
  a.productos_suben,
  a.productos_bajan,
  a.sin_cambio,
  a.nuevos,
  a.creado_en
FROM analisis a
LEFT JOIN proveedores pr ON pr.id = a.proveedor_id
ORDER BY a.creado_en DESC
LIMIT 10;

-- ============================================================
-- DATOS DE EJEMPLO (OPCIONAL)
-- Descommentá para cargar datos de prueba
-- ============================================================
/*
INSERT INTO proveedores (nombre, telefono) VALUES
  ('Distribuidora Norte', '351-555-0001'),
  ('Mayorista Sur',       '351-555-0002');

INSERT INTO productos (nombre, categoria_id, precio_actual, proveedor_id, ultima_fecha) VALUES
  ('Coca Cola 2.25L',    1, 1850.00, 1, CURDATE()),
  ('Sprite 2.25L',       1, 1700.00, 1, CURDATE()),
  ('Agua Villavicencio', 2, 850.00,  2, CURDATE()),
  ('Alfajor Havanna',    4, 1200.00, 1, CURDATE()),
  ('Cigarrillos Marlboro', 5, 3500.00, 2, CURDATE());

INSERT INTO historial_precios (producto_id, proveedor_id, precio, precio_anterior, porcentaje_cambio, fecha_lista) VALUES
  (1, 1, 1600.00, NULL,    NULL,  DATE_SUB(CURDATE(), INTERVAL 30 DAY)),
  (1, 1, 1850.00, 1600.00, 15.63, CURDATE()),
  (2, 1, 1700.00, NULL,    NULL,  CURDATE()),
  (3, 2, 850.00,  NULL,    NULL,  CURDATE()),
  (4, 1, 1200.00, NULL,    NULL,  CURDATE()),
  (5, 2, 3200.00, NULL,    NULL,  DATE_SUB(CURDATE(), INTERVAL 15 DAY)),
  (5, 2, 3500.00, 3200.00, 9.38,  CURDATE());
*/

-- ============================================================
-- FIN DEL SCRIPT
-- ============================================================
