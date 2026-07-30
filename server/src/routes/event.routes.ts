import { Router } from 'express';
import { EventController } from '../controllers/event.controller.js';
import { EventService } from '../services/event.service.js';

const router = Router();
const eventService = new EventService();
const eventController = new EventController(eventService);
