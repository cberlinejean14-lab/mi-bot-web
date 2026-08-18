// Funciones globales del cliente
function toggleUserMenu() {
    const menu = document.getElementById('userDropdownMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }
}

function toggleResourcesMenu() {
    const menu = document.getElementById('resourcesDropdownMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    }
}

function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('prem_theme', newTheme);
    updateThemeIcon(newTheme);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (icon) {
        icon.className = theme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    }
}

// Inicialización de temas al cargar la página
(function() {
    const savedTheme = localStorage.getItem('prem_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
})();

window.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('prem_theme') || 'dark';
    updateThemeIcon(savedTheme);
});

// Cerrar menús desplegables al hacer clic fuera de ellos
window.addEventListener('click', function(e) {
    const userContainer = document.querySelector('.user-dropdown-container');
    const userMenu = document.getElementById('userDropdownMenu');
    if (userContainer && userMenu && !userContainer.contains(e.target)) {
        userMenu.style.display = 'none';
    }

    const resContainer = document.querySelector('.dropdown-container');
    const resMenu = document.getElementById('resourcesDropdownMenu');
    if (resContainer && resMenu && !resContainer.contains(e.target)) {
        resMenu.style.display = 'none';
    }
});