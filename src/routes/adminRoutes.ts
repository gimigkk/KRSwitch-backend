import { Router } from 'express';
import { Server } from 'socket.io';
import statsRouter from './admin/stats';
import logsRouter from './admin/logs';
import classesRouter from './admin/classes';
import usersRouter from './admin/users';
import enrollmentsRouter from './admin/enrollments';
import offersRouter from './admin/offers';
import overrideRouter from './admin/override';
import adminsRouter from './admin/admins';
import systemRouter from './admin/system';

export default (io: Server) => {
  const router = Router();

  router.use('/', statsRouter(io));
  router.use('/', logsRouter(io));
  router.use('/', classesRouter(io));
  router.use('/', usersRouter(io));
  router.use('/', enrollmentsRouter(io));
  router.use('/', offersRouter(io));
  router.use('/', overrideRouter(io));
  router.use('/', adminsRouter(io));
  router.use('/', systemRouter(io));

  return router;
};
