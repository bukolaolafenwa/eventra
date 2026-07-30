export interface CreateEventInput {
  title: string;
  description?: string;
  date: string; // ISO string
  location?: string;
  capacity?: number;
  price?: number;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  date?: string;
  location?: string;
  capacity?: number;
  price?: number;
}

export interface EventFilters {
  startDate?: string;
  endDate?: string;
  location?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface Event {
  id: string;
  title: string;
  description?: string;
  date: string;
  location?: string;
  capacity?: number;
  price?: number;
  status: 'draft' | 'published' | 'cancelled' | 'postponed';
  createdAt: string;
  updatedAt: string;
}